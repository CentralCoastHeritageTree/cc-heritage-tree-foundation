import { clerkClient } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const client = clerkClient();

    // Handle email update (your existing logic)
    if (body.newEmail) {
      const { userId, newEmail, existingEmailId } = body;

      // Add the new email address for the user
      const createdEmail = await client.emailAddresses.createEmailAddress({
        userId: userId,
        emailAddress: newEmail,
        primary: true,
        verified: true,
      });

      const newEmailId = createdEmail.id;
      console.log("New email ID:", newEmailId);

      // Make new email address the primary email
      await client.emailAddresses.updateEmailAddress(newEmailId, {
        primary: true,
      });

      // Delete the old email to clean up
      await client.emailAddresses.deleteEmailAddress(existingEmailId);

      return NextResponse.json({ success: true, newEmailId, message: "Email updated successfully" });
    }

    // Handle other profile updates (name, phone, profile image)
    if (body.action === "updateProfile") {
      const { userId, firstName, lastName, phoneNumber, profileImageUrl } = body;

      // Build the update object with only the fields that are provided
      const updateData: any = {};

      if (firstName !== undefined) {
        updateData.firstName = firstName;
      }

      if (lastName !== undefined) {
        updateData.lastName = lastName;
      }

      if (phoneNumber !== undefined) {
        // Note: Clerk handles phone numbers through phone number objects
        // You might need to create/update phone numbers separately like emails
        // For now, we'll try to update it directly
        updateData.publicMetadata = {
          ...updateData.publicMetadata,
          phoneNumber: phoneNumber,
        };
      }

      if (profileImageUrl !== undefined) {
        updateData.profileImageUrl = profileImageUrl;
      }

      // Update the user with the provided fields
      const updatedUser = await client.users.updateUser(userId, updateData);

      // Handle phone number separately if provided (Clerk's recommended approach)
      if (phoneNumber !== undefined && phoneNumber.trim() !== "") {
        try {
          // First, try to get existing phone numbers
          const user = await client.users.getUser(userId);

          // If user has existing phone numbers, update the primary one
          if (user.phoneNumbers && user.phoneNumbers.length > 0) {
            const primaryPhone =
              user.phoneNumbers.find((phone) => phone.id === user.primaryPhoneNumberId) || user.phoneNumbers[0];

            // Delete old phone number and create new one
            await client.phoneNumbers.deletePhoneNumber(primaryPhone.id);
          }

          // Create new phone number
          const createdPhone = await client.phoneNumbers.createPhoneNumber({
            userId: userId,
            phoneNumber: phoneNumber,
            primary: true,
            verified: true,
          });

          console.log("Phone number updated:", createdPhone.id);
        } catch (phoneError) {
          console.warn("Phone number update failed, but profile update succeeded:", phoneError);
        }
      }

      return NextResponse.json({
        success: true,
        user: updatedUser,
        message: "Profile updated successfully",
      });
    }

    // Handle combined updates (email + profile fields)
    if (body.combinedUpdate) {
      const { userId, newEmail, existingEmailId, firstName, lastName, phoneNumber, profileImageUrl } = body;

      let emailResult = null;
      let profileResult = null;

      // Update email if provided
      if (newEmail) {
        const createdEmail = await client.emailAddresses.createEmailAddress({
          userId: userId,
          emailAddress: newEmail,
          primary: true,
          verified: true,
        });

        await client.emailAddresses.updateEmailAddress(createdEmail.id, {
          primary: true,
        });

        await client.emailAddresses.deleteEmailAddress(existingEmailId);
        emailResult = { newEmailId: createdEmail.id };
      }

      // Update profile fields if any are provided
      const updateData: any = {};
      if (firstName !== undefined) updateData.firstName = firstName;
      if (lastName !== undefined) updateData.lastName = lastName;
      if (profileImageUrl !== undefined) updateData.profileImageUrl = profileImageUrl;
      if (phoneNumber !== undefined) {
        updateData.publicMetadata = { phoneNumber: phoneNumber };
      }

      if (Object.keys(updateData).length > 0) {
        profileResult = await client.users.updateUser(userId, updateData);
      }

      // Handle phone number separately
      if (phoneNumber !== undefined && phoneNumber.trim() !== "") {
        try {
          const user = await client.users.getUser(userId);

          if (user.phoneNumbers && user.phoneNumbers.length > 0) {
            const primaryPhone =
              user.phoneNumbers.find((phone) => phone.id === user.primaryPhoneNumberId) || user.phoneNumbers[0];
            await client.phoneNumbers.deletePhoneNumber(primaryPhone.id);
          }

          await client.phoneNumbers.createPhoneNumber({
            userId: userId,
            phoneNumber: phoneNumber,
            primary: true,
            verified: true,
          });
        } catch (phoneError) {
          console.warn("Phone number update failed:", phoneError);
        }
      }

      return NextResponse.json({
        success: true,
        email: emailResult,
        profile: profileResult,
        message: "All fields updated successfully",
      });
    }

    return NextResponse.json({ error: "Invalid request format" }, { status: 400 });
  } catch (error: any) {
    console.error("Error updating user:", error);
    return NextResponse.json(
      {
        error: error.message || "An error occurred while updating user",
      },
      { status: 500 },
    );
  }
}
