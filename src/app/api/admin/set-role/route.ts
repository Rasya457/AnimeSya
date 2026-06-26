import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";

export async function POST(request: NextRequest) {
  try {
    // 1. Extract Bearer token from Authorization header
    const authHeader = request.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json(
        { error: "Missing or invalid Authorization header" },
        { status: 401 }
      );
    }

    const token = authHeader.slice(7);

    // 2. Verify the caller's ID token
    let decodedToken;
    try {
      decodedToken = await adminAuth.verifyIdToken(token);
    } catch {
      return NextResponse.json(
        { error: "Invalid or expired token" },
        { status: 401 }
      );
    }

    const callerUid = decodedToken.uid;

    // 3. Verify caller is admin from Firestore (not trusting token claims)
    const callerDoc = await adminDb.collection("users").doc(callerUid).get();
    if (!callerDoc.exists || callerDoc.data()?.role !== "admin") {
      return NextResponse.json(
        { error: "Forbidden: admin access required" },
        { status: 403 }
      );
    }

    // 4. Parse request body
    const body = await request.json();
    const { targetUserId, role } = body;

    // Validate inputs
    if (!targetUserId || !role) {
      return NextResponse.json(
        { error: "Missing required fields: targetUserId, role" },
        { status: 400 }
      );
    }

    if (!["user", "admin"].includes(role)) {
      return NextResponse.json(
        { error: 'Invalid role. Must be "user" or "admin"' },
        { status: 400 }
      );
    }

    // Prevent admin from demoting themselves (optional safety check)
    if (targetUserId === callerUid && role !== "admin") {
      return NextResponse.json(
        { error: "Cannot change your own role" },
        { status: 400 }
      );
    }

    // 5. Check target user exists
    const targetDoc = await adminDb.collection("users").doc(targetUserId).get();
    if (!targetDoc.exists) {
      return NextResponse.json(
        { error: "Target user not found" },
        { status: 404 }
      );
    }

    // 6. Update the target user's role
    await adminDb.collection("users").doc(targetUserId).update({ role });

    return NextResponse.json({
      success: true,
      message: `User ${targetUserId} role updated to ${role}`,
    });
  } catch (error) {
    console.error("Error in set-role API:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
