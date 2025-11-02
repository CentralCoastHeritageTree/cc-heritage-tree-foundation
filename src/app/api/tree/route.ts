import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/database/db";
import Tree from "@/database/treeSchema";
import s3 from "@/app/api/tree/aws";
import { revalidateTag } from "next/cache";
import mongoose from "mongoose";
import { Buffer } from "buffer";

// Force Node.js runtime
export const runtime = "nodejs";

// Counter schema for sequential IDs
const counterSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  sequenceValue: { type: Number, default: 0 },
});
const Counter = mongoose.models.Counter || mongoose.model("Counter", counterSchema);

const MAX_IMAGE_SIZE = 2 * 1024 * 1024; // 2MB
const JPEG_QUALITY = 0.85;
const MAX_DIMENSION = 1920;

// Lazy load heavy deps
async function loadImageProcessors() {
  const sharp = (await import("sharp")).default;
  const heicConvert = (await import("heic-convert")).default;
  return { sharp, heicConvert };
}

async function processImage(file: File): Promise<{ buffer: Buffer; filename: string; contentType: string }> {
  try {
    const { sharp, heicConvert } = await loadImageProcessors();
    const arrayBuffer = await file.arrayBuffer();

    // Guard for empty files
    if (!arrayBuffer || file.size === 0) {
      console.warn(`Skipping empty file: ${file.name}`);
      return { buffer: Buffer.alloc(0), filename: file.name, contentType: "application/octet-stream" };
    }

    let buffer = Buffer.from(arrayBuffer);
    let filename = file.name;
    let contentType = file.type || "application/octet-stream";

    const isHEIC = file.type === "image/heic" || file.name.toLowerCase().endsWith(".heic");

    // HEIC → JPEG conversion (for non-converted HEICs)
    if (isHEIC) {
      console.log(`Converting HEIC file on server: ${filename}`);
      try {
        const jpegBuffer = await heicConvert({
          buffer: buffer as unknown as ArrayBuffer,
          format: "JPEG",
          quality: 1,
        });
        buffer = Buffer.from(jpegBuffer);
        filename = filename.replace(/\.(heic|HEIC)$/i, ".jpg");
        contentType = "image/jpeg";
      } catch (heicError) {
        console.error(`HEIC conversion failed for ${filename}:`, heicError);
        // Fallback: skip or upload raw buffer if needed
        return { buffer: Buffer.alloc(0), filename, contentType };
      }
    }

    // Use sharp to resize/compress
    const { width, height } = await sharp(buffer).metadata();
    let processedBuffer = buffer;

    const needsResize = (width && width > MAX_DIMENSION) || (height && height > MAX_DIMENSION);
    if (needsResize || buffer.length > MAX_IMAGE_SIZE) {
      let quality = Math.floor(JPEG_QUALITY * 100);

      processedBuffer = await sharp(buffer)
        .resize(MAX_DIMENSION, MAX_DIMENSION, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality })
        .toBuffer();

      // progressive compression loop
      while (processedBuffer.length > MAX_IMAGE_SIZE && quality > 20) {
        quality -= 10;
        processedBuffer = await sharp(buffer)
          .resize(MAX_DIMENSION, MAX_DIMENSION, { fit: "inside", withoutEnlargement: true })
          .jpeg({ quality })
          .toBuffer();
      }

      console.log(`Compressed ${filename} to ${(processedBuffer.length / 1024 / 1024).toFixed(2)} MB`);
    }

    // Ensure final JPEG filename
    if (!filename.toLowerCase().endsWith(".jpg") && !filename.toLowerCase().endsWith(".jpeg")) {
      filename = filename.replace(/\.[^.]+$/, ".jpg");
    }

    return { buffer: processedBuffer, filename, contentType: "image/jpeg" };
  } catch (error) {
    console.error("Image processing error:", error);
    // Return an empty buffer to skip upload instead of crashing
    return { buffer: Buffer.alloc(0), filename: "invalid.jpg", contentType: "image/jpeg" };
  }
}

export async function POST(req: NextRequest) {
  await connectDB();

  try {
    const formData = await req.formData();

    // Sequential ID counter
    const counter = await Counter.findOneAndUpdate(
      { _id: "treeId" },
      { $inc: { sequenceValue: 1 } },
      { new: true, upsert: true },
    );
    const nextTreeID = counter.sequenceValue;

    const files = formData.getAll("files") as File[];
    const imageUrls: string[] = [];

    for (const file of files) {
      if (!(file instanceof File) || file.size === 0) continue;

      try {
        const { buffer, filename, contentType } = await processImage(file);

        const params = {
          Bucket: process.env.AWS_S3_BUCKET_NAME!,
          Key: `${Date.now()}_${filename}`,
          Body: buffer,
          ContentType: contentType,
        };

        const result = await s3.upload(params).promise();
        imageUrls.push(result.Location);
      } catch (imageError) {
        console.error(`Failed to process image ${file.name}:`, imageError);
      }
    }
    const treeData = {
      treeId: nextTreeID,
      collectorName: formData.get("collectorName"),
      dateCollected: new Date(formData.get("dateCollected") as string),
      species: formData.get("species"),
      dbh: formData.get("dbh"),
      canopyBreadth: formData.get("canopyBreadth"),
      treeHeight: Number(formData.get("treeHeight")),
      treeQuality: Number(formData.get("treeQuality")),
      additionalNotes: formData.get("additionalNotes"),
      gpsCoordinates: [formData.get("gpsCoordinates[0]"), formData.get("gpsCoordinates[1]")],
      treeCondition: Array.from(formData.entries())
        .filter(([key]) => key.startsWith("treeCondition["))
        .map(([, value]) => value),
      photo: imageUrls,
    };

    const newTree = new Tree(treeData);
    const createdTree = await newTree.save();
    revalidateTag("trees");

    return NextResponse.json({ message: "Success", data: createdTree }, { status: 200 });
  } catch (error) {
    console.error("Error submitting tree:", error);
    return NextResponse.json(
      { error: "Error processing form", details: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}

export async function GET(request: Request) {
  await connectDB();
  const { searchParams } = new URL(request.url);
  const collectorName = searchParams.get("collectorName");

  try {
    const query = collectorName
      ? { collectorName: { $regex: `^${decodeURIComponent(collectorName)}$`, $options: "i" } }
      : {};
    const trees = await Tree.find(query).lean();

    const serialized = trees.map((tree) => ({
      ...tree,
      gpsCoordinates: tree.gpsCoordinates.map((coord: any) => coord.toString()),
      dbh: tree.dbh.toString(),
      canopyBreadth: tree.canopyBreadth.toString(),
      treeHeight: tree.treeHeight.toString(),
      treeQuality: tree.treeQuality.toString(),
      photos: tree.photo?.map((p: any) => p?.toString()),
    }));

    return NextResponse.json(serialized, { status: 200 });
  } catch (err) {
    return NextResponse.json({ message: "Failed to fetch trees: " + err }, { status: 400 });
  }
}
