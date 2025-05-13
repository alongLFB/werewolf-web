import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/utils/supabase/server";

// 假设你有一个函数来生成唯一的邀请码 (与之前相同)
const generateInviteCode = (length = 6): string => {
  const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return result;
};

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();

  try {
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { gameSettingsChoice } = body;

    if (
      !gameSettingsChoice ||
      (gameSettingsChoice !== "A" && gameSettingsChoice !== "B")
    ) {
      return NextResponse.json(
        { message: "Invalid game settings choice." },
        { status: 400 }
      );
    }

    let inviteCode = "";
    let codeIsUnique = false;
    let attempts = 0;
    const maxAttempts = 10;

    while (!codeIsUnique && attempts < maxAttempts) {
      inviteCode = generateInviteCode();
      const { data: existingRoom, error: checkError } = await supabase
        .from("game_rooms")
        .select("id")
        .eq("invite_code", inviteCode)
        .maybeSingle();

      if (checkError) {
        console.error(
          "Error checking invite code uniqueness:",
          checkError.message
        );
        // 根据错误类型决定是否继续尝试或直接失败
        if (attempts === maxAttempts - 1) {
          // 最后一次尝试失败
          return NextResponse.json(
            { message: "Database error checking invite code." },
            { status: 500 }
          );
        }
      } else if (!existingRoom) {
        codeIsUnique = true;
      }
      attempts++;
    }

    if (!codeIsUnique) {
      return NextResponse.json(
        { message: "Failed to generate a unique invite code." },
        { status: 500 }
      );
    }

    const { data: newRoom, error: insertError } = await supabase
      .from("game_rooms")
      .insert({
        host_user_id: user.id,
        invite_code: inviteCode,
        game_settings_choice: gameSettingsChoice,
        status: "lobby",
      })
      .select("id, invite_code")
      .single();

    if (insertError) {
      console.error("Supabase insert error (game_rooms):", insertError);
      return NextResponse.json(
        { message: insertError.message || "Failed to create room" },
        { status: 500 }
      );
    }
    if (!newRoom) {
      return NextResponse.json(
        { message: "Room created but no data returned." },
        { status: 500 }
      );
    }

    // 房主自动加入 room_players
    const { error: playerInsertError } = await supabase
      .from("room_players")
      .insert({
        room_id: newRoom.id,
        user_id: user.id,
        // seat_number: 1, // 可选：房主默认1号位
        is_ready: false,
      });

    if (playerInsertError) {
      console.warn(
        "Failed to add host to room_players on room creation:",
        playerInsertError.message
      );
      // 房间已创建，但房主加入失败，可能需要处理或记录
    }

    return NextResponse.json(
      { roomId: newRoom.id, inviteCode: newRoom.invite_code },
      { status: 201 }
    );
  } catch (error: unknown) {
    if (error instanceof Error) {
      console.error("API Error /api/rooms/create:", error.message);
    } else {
      console.error("API Error /api/rooms/create:", error);
    }
    // 确保返回 NextResponse
    return NextResponse.json(
      {
        message:
          error instanceof Error ? error.message : "Internal Server Error",
      },
      { status: 500 }
    );
  }
}
