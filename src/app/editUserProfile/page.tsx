"use client";
import {
  Grid,
  GridItem,
  Image,
  Text,
  Button,
  IconButton,
  Flex,
  Box,
  Center,
  Input,
  FormControl,
  Spinner,
  VStack,
} from "@chakra-ui/react";
import React, { useRef, useEffect, useState } from "react";
import { InputUser, TextUser } from "@/styles/UserStyle";
import { CenterStyle } from "@/styles/AllStyle";
import { useUser } from "@clerk/nextjs";
import { isMobile } from "react-device-detect";
import { FileDown } from "lucide-react";
import { useRouter } from "next/navigation";

export default function EditUserProfile() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [profileURL, setProfileURL] = useState("/pfp.png");
  const router = useRouter();

  // to compare changes
  const [originalUserData, setOriginalUserData] = useState({
    name: "",
    email: "",
    phoneNumber: "",
    profileURL: "/pfp.png",
  });

  const { user, isLoaded } = useUser();
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [existingEmailId, setExistingEmailId] = useState<string | null>(null);
  const [mongoUserId, setMongoUserId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  // create file input ref
  const fileInputRef = useRef<HTMLInputElement>(null);

  // for toast
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [toastStatus, setToastStatus] = useState<"success" | "error" | null>(null);

  const showToast = (message: string, status: "success" | "error") => {
    setToastMsg(message);
    setToastStatus(status);

    setTimeout(() => {
      setToastMsg(null);
      setToastStatus(null);
    }, 3000);
  };

  const [isClient, setIsClient] = useState(false);
  const [isMobileDevice, setIsMobileDevice] = useState(false);

  useEffect(() => {
    setIsClient(true);
    setIsMobileDevice(isMobile);
  }, []);

  useEffect(() => {
    const fetchUserData = async () => {
      if (!isLoaded || !user?.primaryEmailAddress?.emailAddress) return;

      try {
        const email = user.primaryEmailAddress.emailAddress.toLowerCase();
        setUserId(user.id); // clerk id
        setExistingEmailId(user.primaryEmailAddressId);
        const res = await fetch(`/api/user/${email}`);
        const data = await res.json();
        setMongoUserId(data._id);

        const userData = {
          name: data.name || "",
          email: data.email || "",
          phoneNumber: data.phoneNumber || "",
          profileURL: data.profileURL || "/pfp.png",
        };

        setName(userData.name);
        setEmail(userData.email);
        setPhoneNumber(userData.phoneNumber);
        setProfileURL(userData.profileURL);
        setOriginalUserData(userData);
      } catch (error) {
        console.error("Failed to fetch user data:", error);
        showToast("Failed to load user data", "error");
      } finally {
        setLoading(false);
      }
    };

    fetchUserData();
  }, [isLoaded, user]);

  const uploadFile = async (file: any) => {
    if (!file) return;

    setUploading(true);

    try {
      // create a formData
      const form = new FormData();
      form.append("file", file);

      const response = await fetch("/api/profile/", {
        method: "POST",
        body: form,
      });

      if (response.ok) {
        // update profileURL
        const data = await response.json();
        setProfileURL(data.url);
        showToast("Profile picture uploaded successfully!", "success");
      } else {
        showToast("Upload failed!", "error");
      }
    } catch (error) {
      console.error("Upload error:", error);
      showToast("Upload failed!", "error");
    } finally {
      setUploading(false);
    }
  };

  const saveUserInfo = async () => {
    if (saving) return; // Prevent double submission

    setSaving(true);

    try {
      // Check what fields have changed
      const updatedFields: any = {};
      let hasChanges = false;

      if (name.trim() !== originalUserData.name) {
        updatedFields.name = name.trim();
        hasChanges = true;
      }
      if (email.toLowerCase() !== originalUserData.email.toLowerCase()) {
        updatedFields.email = email.toLowerCase();
        hasChanges = true;
      }
      if (phoneNumber.trim() !== originalUserData.phoneNumber) {
        updatedFields.phoneNumber = phoneNumber.trim();
        hasChanges = true;
      }
      if (profileURL !== originalUserData.profileURL) {
        updatedFields.profileURL = profileURL;
        hasChanges = true;
      }

      if (!hasChanges) {
        showToast("No changes made.", "error");
        return;
      }

      let clerkUpdateSuccess = true;
      let mongoUpdateSuccess = true;

      // === Update Clerk (for ALL fields if there are any changes) ===
      try {
        const clerkPayload: any = {
          userId,
          combinedUpdate: true,
        };

        // Add email fields if email changed
        if (updatedFields.email !== undefined) {
          clerkPayload.newEmail = updatedFields.email;
          clerkPayload.existingEmailId = existingEmailId;
        }

        // Add profile fields if they changed
        if (updatedFields.name !== undefined) {
          const nameParts = updatedFields.name.trim().split(" ");
          clerkPayload.firstName = nameParts[0] || "";
          clerkPayload.lastName = nameParts.slice(1).join(" ") || "";
        }

        if (updatedFields.phoneNumber !== undefined) {
          clerkPayload.phoneNumber = updatedFields.phoneNumber;
        }

        if (updatedFields.profileURL !== undefined) {
          clerkPayload.profileImageUrl = updatedFields.profileURL;
        }

        const clerkResponse = await fetch("/api/clerk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(clerkPayload),
        });

        const clerkData = await clerkResponse.json();

        if (!clerkResponse.ok) {
          console.error("Clerk update failed:", clerkData);
          clerkUpdateSuccess = false;
          throw new Error(clerkData.error || "Failed to update user in Clerk.");
        }

        console.log("User updated on Clerk:", clerkData);
      } catch (error) {
        console.error("Clerk update error:", error);
        clerkUpdateSuccess = false;
        throw error;
      }

      // === Update MongoDB (for ALL fields if there are any changes) ===
      try {
        const mongoResponse = await fetch(`/api/user/${mongoUserId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updatedFields),
        });

        const mongoData = await mongoResponse.json();

        if (!mongoResponse.ok) {
          console.error("MongoDB update failed:", mongoData);
          mongoUpdateSuccess = false;
          throw new Error(mongoData.error || "Failed to update user data in database.");
        }

        console.log("User updated on MongoDB:", mongoData.user);
      } catch (error) {
        console.error("MongoDB update error:", error);
        mongoUpdateSuccess = false;
        throw error;
      }

      // If we get here, both updates succeeded
      showToast("Profile updated successfully in both systems!", "success");

      // Update the original data to reflect the changes
      const newOriginalData = {
        name: updatedFields.name !== undefined ? updatedFields.name : originalUserData.name,
        email: updatedFields.email !== undefined ? updatedFields.email : originalUserData.email,
        phoneNumber: updatedFields.phoneNumber !== undefined ? updatedFields.phoneNumber : originalUserData.phoneNumber,
        profileURL: updatedFields.profileURL !== undefined ? updatedFields.profileURL : originalUserData.profileURL,
      };

      setOriginalUserData(newOriginalData);

      // Navigate back to profile page after a short delay
      setTimeout(() => {
        router.push("/userProfile");
      }, 1500);
    } catch (error) {
      console.error("Error updating information:", error);

      // More specific error messages
      const errorMessage = error instanceof Error ? error.message : "An unexpected error occurred.";

      if (errorMessage.includes("email") || errorMessage.includes("Email")) {
        showToast("Update failed - email may already be in use.", "error");
      } else {
        showToast("Failed to update profile. Please try again.", "error");
      }
    } finally {
      setSaving(false);
    }
  };

  if (!isClient) {
    return null;
  }

  if (loading) {
    return (
      <Center minH="100vh" bg="#F4F1E8">
        <Spinner size="xl" color="#596334" />
      </Center>
    );
  }

  return (
    <div style={{ backgroundColor: "#F4F1E8", minHeight: "100vh", width: "100%", overflowY: "auto" }}>
      <Box maxH="100vh" px={{ base: 4, md: 8 }} py={{ base: 4, md: 6 }}>
        <Center>
          <Flex mt={{ base: 4, md: 25 }} direction="column" w="100%" maxW="900px">
            {/* Header with Toast */}
            <Flex
              align="center"
              justify="space-between"
              direction={{ base: "column", md: "row" }}
              gap={{ base: 4, md: 0 }}
              mb={{ base: 4, md: 0 }}
            >
              <Text
                fontSize={{ base: "2xl", md: "3xl" }}
                fontWeight="bold"
                textStyle="4xl"
                textAlign={{ base: "center", md: "left" }}
              >
                Edit User Profile
              </Text>
              {toastMsg && (
                <Box
                  borderRadius="lg"
                  px={4}
                  py={2}
                  bg="white"
                  color="black"
                  fontWeight="medium"
                  w={{ base: "100%", md: "auto" }}
                >
                  <Flex align="center" gap={4}>
                    {toastStatus === "success" ? (
                      // Success Icon
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="30"
                        height="30"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="#596334"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <circle cx="12" cy="12" r="10" />
                        <path d="m9 12 2 2 4-4" />
                      </svg>
                    ) : (
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="24"
                        height="24"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="red"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="lucide lucide-circle-x-icon lucide-circle-x"
                      >
                        <circle cx="12" cy="12" r="10" />
                        <path d="m15 9-6 6" />
                        <path d="m9 9 6 6" />
                      </svg>
                    )}
                    <Flex direction={"column"}>
                      {toastStatus === "success" ? (
                        <Text size="med" fontWeight={"bold"}>
                          Saved
                        </Text>
                      ) : (
                        <Text size="med">Error</Text>
                      )}
                      <Text>{toastMsg}</Text>
                    </Flex>
                  </Flex>
                </Box>
              )}
            </Flex>

            {/* Main Content Box */}
            <Box
              borderRadius={"15px"}
              mt={{ base: 6, md: 30 }}
              alignItems="center"
              borderColor="black"
              bg="white"
              w="100%"
              minH={{ base: "auto", md: "475px" }}
              p={{ base: 4, md: 10 }}
              color="black"
            >
              {/* Mobile Layout */}
              {isMobileDevice ? (
                <VStack spacing={6} align="stretch">
                  {/* Profile Picture Section */}
                  <Center>
                    <Box position="relative" w="200px" h="200px">
                      {uploading ? (
                        <Center w="100%" h="100%">
                          <Spinner size="xl" color="#596334" />
                        </Center>
                      ) : (
                        <Image
                          boxSize="200px"
                          borderRadius="full"
                          fit="cover"
                          alt="Profile Picture Not Appearing"
                          src={profileURL}
                        />
                      )}
                      {/* Upload overlay */}
                      <Box
                        position="absolute"
                        top={0}
                        left={0}
                        w="100%"
                        h="100%"
                        display="flex"
                        alignItems="center"
                        justifyContent="center"
                        borderRadius="full"
                        boxSize="200px"
                        bg="blackAlpha.600"
                        opacity={0}
                        _hover={{ opacity: 1 }}
                        transition="opacity 0.3s ease"
                      >
                        <IconButton
                          w="100%"
                          h="100%"
                          aria-label="Upload"
                          icon={<FileDown size="60px" />}
                          onClick={() => fileInputRef.current?.click()}
                          colorScheme="whiteAlpha"
                          borderRadius="full"
                          fontSize="4xl"
                        />
                      </Box>
                      {/* Hidden file input */}
                      <Input
                        type="file"
                        accept="image/*"
                        display="none"
                        ref={fileInputRef}
                        onChange={(e) => uploadFile(e.target.files?.[0])}
                      />
                    </Box>
                  </Center>

                  {/* Form Section */}
                  <FormControl>
                    <VStack spacing={4} align="stretch">
                      <Box>
                        <Text {...TextUser} mb={2}>
                          Name
                        </Text>
                        <Input
                          {...InputUser}
                          placeholder="Name"
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          type="text"
                        />
                      </Box>
                      <Box>
                        <Text {...TextUser} mb={2}>
                          Email
                        </Text>
                        <Input
                          {...InputUser}
                          placeholder="Email"
                          value={email}
                          onChange={(e) => setEmail(e.target.value.toLowerCase())}
                          type="email"
                        />
                      </Box>
                      <Box>
                        <Text {...TextUser} mb={2}>
                          Phone
                        </Text>
                        <Input
                          {...InputUser}
                          placeholder="Phone Number"
                          value={phoneNumber}
                          onChange={(e) => setPhoneNumber(e.target.value)}
                          type="text"
                        />
                      </Box>

                      {/* Buttons */}
                      <VStack spacing={3} pt={4}>
                        <Button onClick={saveUserInfo} borderRadius={20} backgroundColor="#596334" w="100%" size="lg">
                          <Text color="white">Save</Text>
                        </Button>
                        <Button
                          onClick={() => router.push("/userProfile")}
                          borderRadius={20}
                          backgroundColor="white"
                          borderColor="#596334"
                          borderWidth={1}
                          w="100%"
                          size="lg"
                        >
                          <Text color="#596334">Cancel</Text>
                        </Button>
                      </VStack>
                    </VStack>
                  </FormControl>
                </VStack>
              ) : (
                /* Desktop Layout */
                <Grid templateRows="repeat(2, 0.5fr)" templateColumns="repeat(5, 1fr)" gap={7}>
                  <GridItem rowSpan={2} colSpan={2}>
                    <Center>
                      <Box position="relative" w="300px" h="300px">
                        {/* profile pic */}
                        {uploading ? (
                          <Center w="100%" h="100%">
                            <Spinner size="xl" color="#596334" />
                          </Center>
                        ) : (
                          <Image
                            ml={10}
                            mt={10}
                            boxSize="300px"
                            borderRadius="full"
                            fit="cover"
                            alt="Profile Picture Not Appearing"
                            src={profileURL}
                          />
                        )}
                        {/* icon when hovered */}
                        <Box
                          position="absolute"
                          top={0}
                          left={0}
                          w="100%"
                          h="100%"
                          display="flex"
                          alignItems="center"
                          justifyContent="center"
                          borderRadius="full"
                          ml={10}
                          mt={10}
                          boxSize="300px"
                          bg="blackAlpha.600"
                          opacity={0}
                          _hover={{ opacity: 1 }}
                          transition="opacity 0.3s ease"
                        >
                          <IconButton
                            w="100%"
                            h="100%"
                            aria-label="Upload"
                            icon={<FileDown size="120px" />}
                            onClick={() => fileInputRef.current?.click()}
                            colorScheme="whiteAlpha"
                            borderRadius="full"
                            fontSize="6xl"
                          />
                        </Box>

                        {/* hidden */}
                        <Input
                          type="file"
                          accept="image/*"
                          display="none"
                          ref={fileInputRef}
                          onChange={(e) => uploadFile(e.target.files?.[0])}
                        />
                      </Box>
                    </Center>
                  </GridItem>
                  <GridItem colSpan={3} mt={10}>
                    <FormControl>
                      <Center {...CenterStyle}>
                        <Text {...TextUser} mt={4} mr={30}>
                          Name
                        </Text>
                        <Input
                          {...InputUser}
                          mt={4}
                          placeholder="Name"
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          type="text"
                        />
                      </Center>
                      <Center {...CenterStyle}>
                        <Text {...TextUser} mr={34} mt={10}>
                          Email
                        </Text>
                        <Input
                          {...InputUser}
                          mt={10}
                          placeholder="Email"
                          value={email}
                          onChange={(e) => setEmail(e.target.value.toLowerCase())}
                          type="email"
                        />
                      </Center>
                      <Center>
                        <Text mr={30} {...TextUser} mt={10}>
                          Phone
                        </Text>
                        <Input
                          {...InputUser}
                          mt={10}
                          placeholder="Phone Number"
                          value={phoneNumber}
                          onChange={(e) => setPhoneNumber(e.target.value)}
                          type="text"
                        />
                      </Center>
                      <Center {...CenterStyle}>
                        <Box>
                          <Button onClick={saveUserInfo} mt={10} borderRadius={20} backgroundColor="#596334">
                            <Text color="white">Save</Text>
                          </Button>
                        </Box>
                        <Box onClick={() => router.push("/userProfile")}>
                          <Button
                            mt={10}
                            ml={5}
                            borderRadius={20}
                            backgroundColor="white"
                            borderColor="#596334"
                            borderWidth={1}
                          >
                            <Text color="#596334">Cancel</Text>
                          </Button>
                        </Box>
                      </Center>
                    </FormControl>
                  </GridItem>
                </Grid>
              )}
            </Box>
          </Flex>
        </Center>
      </Box>
    </div>
  );
}
