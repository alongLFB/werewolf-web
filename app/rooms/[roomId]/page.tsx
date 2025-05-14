"use client"; // 这个页面会有大量交互和状态，所以是客户端组件

import { useEffect, useState, useCallback, useMemo } from "react";
import { useParams, useRouter } from "next/navigation"; // 使用 next/navigation
import { RealtimeChannel, User } from "@supabase/supabase-js";
import { createBrowserSupabaseClient } from "@/utils/supabase/client"; // 你的客户端 Supabase

// Define Player and GameRoom interfaces (ensure they are complete)
interface Player {
  id: string; // user_id from room_players which references profiles.id
  user_id: string;
  nickname: string;
  seat_number: number | null;
  role?: string | null;
  is_alive: boolean;
  is_ready?: boolean;
  connection_status?: string;
  // Ensure all fields from your DB table room_players are here,
  // especially those that might be in payload.new or payload.old
}

interface GameRoom {
  id: string;
  invite_code: string;
  host_user_id: string;
  status: string;
  game_settings_choice: "A" | "B";
  current_round_number: number;
  current_turn_player_id?: string | null;
  police_badge_holder_id?: string | null;
  speaker_order?: string[];
  winning_faction?: string | null;
}

interface NightActions {
  wolfTarget?: string | null;
  seerCheckedUser?: { userId: string; role: "wolf" | "good" } | null;
}

export default function RoomPage() {
  const params = useParams();
  const router = useRouter();
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);

  const roomId = params.roomId as string;

  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [roomDetails, setRoomDetails] = useState<GameRoom | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  // const [myPlayerInfo, setMyPlayerInfo] = useState<Player | null>(null); // REMOVED: Will be derived
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // const [gameLog, setGameLog] = useState<string[]>([]);
  const [nightActions, setNightActions] = useState<NightActions>({});
  const [roomChannel, setRoomChannel] = useState<RealtimeChannel | null>(null);

  // DERIVE myPlayerInfo from players list and currentUser
  const myPlayerInfo = useMemo(() => {
    if (!currentUser || !players.length) return null;
    return players.find((p) => p.user_id === currentUser.id) || null;
  }, [players, currentUser]);

  useEffect(() => {
    const getUser = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.push(
          `/login?message=Please login to access rooms&redirectedFrom=/rooms/${roomId}`
        );
      } else {
        setCurrentUser(user);
      }
    };
    getUser();
  }, [supabase, router, roomId]);

  const fetchInitialData = useCallback(async () => {
    if (!currentUser || !roomId) return;
    setIsLoading(true);
    setError(null);

    try {
      const { data: roomData, error: roomError } = await supabase
        .from("game_rooms")
        .select("*")
        .eq("id", roomId)
        .single();

      if (roomError || !roomData) {
        throw new Error(
          roomError?.message ||
            "Room not found or unable to fetch room details."
        );
      }
      setRoomDetails(roomData as GameRoom);

      const { data: playersData, error: playersError } = await supabase
        .from("room_players")
        .select("*, profile:profiles (nickname)") // You are already fetching the profile nickname
        .eq("room_id", roomId)
        .order("seat_number");

      if (playersError) {
        throw new Error(playersError.message || "Failed to fetch players.");
      }

      const formattedPlayers = playersData.map(
        (p: any) => // Changed type of p to any, as it's raw data from the query
          ({
            // Explicitly map all fields from Player interface
            id: p.user_id,
            user_id: p.user_id,
            nickname: p.profile.nickname || `玩家${p.seat_number || "未知"}`, // Use profile.nickname here
            seat_number: p.seat_number,
            role: p.role,
            is_alive: p.is_alive,
            is_ready: p.is_ready,
            connection_status: p.connection_status,
            // ... add any other fields from your DB room_players table that are part of Player type
          } as Player)
      );
      setPlayers(formattedPlayers);

      // No need to setMyPlayerInfo explicitly here, it's derived.
      // We can check if the current user is in the fetched list for debugging or redirection.
      const currentPlayerInRoom = formattedPlayers.find(
        (p) => p.user_id === currentUser.id
      );
      if (!currentPlayerInRoom && roomData.status !== "finished") {
        console.warn(
          "Current user not found in player list after initial fetch, but room is active."
        );
      }
    } catch (error: unknown) {
      console.error("Error fetching initial room data:", error);
      const errorMessage =
        error instanceof Error ? error.message : "Error selecting seat";
      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  }, [supabase, roomId, currentUser]); // router was removed as it's stable from next/navigation

  useEffect(() => {
    if (currentUser && roomId) {
      fetchInitialData();
    }
  }, [currentUser, roomId, fetchInitialData]);

  useEffect(() => {
    if (!roomId || !supabase || !currentUser) return; // Ensure currentUser is available for private channel events

    if (roomChannel) {
      supabase.removeChannel(roomChannel).catch(console.error);
    }

    const newChannel = supabase
      .channel(`room-${roomId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "game_rooms",
          filter: `id=eq.${roomId}`,
        },
        (payload) => {
          console.log("Game room change received!", payload);
          if (payload.new) {
            setRoomDetails((prev) => ({
              ...prev,
              ...(payload.new as GameRoom),
            }));
          }
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*", // Listen to all (INSERT, UPDATE, DELETE)
          schema: "public",
          table: "room_players",
          filter: `room_id=eq.${roomId}`,
        },
        async (payload) => {
          console.log("Room players change received!", payload);
          const { eventType, new: newRecord, old: oldRecord } = payload;

          if (eventType === "INSERT") {
            const newPlayerRaw = newRecord as Player;
            const { data: profileData } = await supabase
              .from("profiles")
              .select("nickname")
              .eq("id", newPlayerRaw.user_id)
              .single();

            const newPlayer: Player = {
              id: newPlayerRaw.user_id,
              user_id: newPlayerRaw.user_id,
              nickname:
                profileData?.nickname ||
                newPlayerRaw.nickname ||
                `玩家${newPlayerRaw.seat_number || "新"}`,
              seat_number: newPlayerRaw.seat_number,
              role: newPlayerRaw.role,
              is_alive: newPlayerRaw.is_alive,
              is_ready: newPlayerRaw.is_ready,
              connection_status: newPlayerRaw.connection_status,
            };
            setPlayers((prev) =>
              [...prev, newPlayer].sort(
                (a, b) => (a.seat_number || 999) - (b.seat_number || 999) // Use a large number for null seats
              )
            );
          } else if (eventType === "UPDATE") {
            const updatedPlayerRaw = newRecord as Player;
            setPlayers((prev) =>
              prev
                .map((p) => {
                  if (p.user_id === updatedPlayerRaw.user_id) {
                    // Merge carefully, ensuring all Player fields are handled
                    return {
                      ...p, // Keep existing data like nickname, id
                      ...updatedPlayerRaw, // Apply changes from payload
                    };
                  }
                  return p;
                })
                .sort((a, b) => (a.seat_number || 999) - (b.seat_number || 999))
            );
          } else if (eventType === "DELETE") {
            const deletedPlayerRaw = oldRecord as Player;
            setPlayers((prev) =>
              prev.filter((p) => p.user_id !== deletedPlayerRaw.user_id)
            );
          }
        }
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "game_actions",
          filter: `room_id=eq.${roomId}`,
        },
        (payload) => {
          console.log("Game action received!", payload);
          // const action = payload.new as any;
          // setGameLog(prev => [...prev, formatGameAction(action)]);
        }
      )
      // ... 在 useEffect 用于 Realtime 订阅的回调中 for 'room_players' ...
      .on(
        "postgres_changes",
        {
          event: "UPDATE", // 可以更精确地只监听 UPDATE，或用 *
          schema: "public",
          table: "room_players",
          filter: `room_id=eq.${roomId}`,
        },
        (payload) => {
          console.log("Realtime: Room players UPDATE received!", payload);
          const updatedPlayerRaw = payload.new as Player;

          // 更新 players 列表
          setPlayers((prevPlayers) =>
            prevPlayers
              .map((p) =>
                p.user_id === updatedPlayerRaw.user_id
                  ? {
                      ...p,
                      ...updatedPlayerRaw,
                      id: updatedPlayerRaw.user_id,
                      nickname: p.nickname,
                    }
                  : p
              )
              .sort((a, b) => (a.seat_number || 99) - (b.seat_number || 99))
          );
        }
      )
      // 同时，`game_rooms` 表的 Realtime 回调会更新 roomDetails.status 为 'in_game_night'
      // 这会触发UI切换到夜晚阶段的渲染。
      .on("broadcast", { event: "turn_change" }, (payload) => {
        console.log("Turn change event:", payload);
      })
      .on(
        "broadcast",
        { event: "night_action_result" }, // Use currentUser.id directly
        (payload) => {
          console.log("Private night action result:", payload);
          if (payload.payload.for_user !== currentUser.id) return;
          if (payload.payload.type === "seer_result") {
            // Supabase wraps broadcast payloads in a 'payload' object
            setNightActions((prev) => ({
              ...prev,
              seerCheckedUser: payload.payload
                .data as NightActions["seerCheckedUser"],
            }));
          }
        }
      )
      .subscribe((status, err) => {
        if (status === "SUBSCRIBED") {
          console.log(`Subscribed to room-${roomId}`);
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.error(`Subscription error on room-${roomId}: ${status}`, err);
          setError(
            `Connection error with the room (${status}). Please refresh.`
          );
        }
      });

    setRoomChannel(newChannel);

    return () => {
      if (newChannel) {
        supabase
          .removeChannel(newChannel)
          .then(() => console.log(`Unsubscribed from room-${roomId}`))
          .catch(console.error);
        setRoomChannel(null);
      }
    };
  }, [roomId, supabase, currentUser]); // currentUser is essential here

  useEffect(() => {
    if (roomChannel && currentUser && myPlayerInfo) {
      // myPlayerInfo could be used here if it has info not in currentUser
      roomChannel.track({
        user_id: currentUser.id,
        online_at: new Date().toISOString(),
        nickname: myPlayerInfo.nickname || currentUser.email, // Use derived myPlayerInfo's nickname
      });

      const interval = setInterval(() => {
        roomChannel.track({
          user_id: currentUser.id,
          online_at: new Date().toISOString(),
        });
      }, 5 * 60 * 1000);

      return () => clearInterval(interval);
    }
  }, [roomChannel, currentUser, myPlayerInfo]); // Add myPlayerInfo if its properties are used in track

  const handleLeaveRoom = useCallback(async () => {
    if (!currentUser || !roomDetails) {
      alert("无法获取用户信息或房间信息。");
      return;
    }

    const isHost = currentUser.id === roomDetails.host_user_id;

    if (isHost) {
      if (
        window.confirm(
          "您是房主，退出房间将会关闭该房间。确定要退出并关闭房间吗？"
        )
      ) {
        try {
          // Update room status to 'closed'
          const { error: updateRoomError } = await supabase
            .from("game_rooms")
            .update({ status: "closed" }) // You might want a specific 'closed_by_host' status
            .eq("id", roomId);

          if (updateRoomError) {
            throw updateRoomError;
          }
          // Optionally, you could also remove all players from room_players here
          // or handle it via a database trigger or backend function when room status changes.
          alert("房间已关闭。");
          router.push("/");
        } catch (error: any) {
          console.error("Error closing room:", error);
          alert(`关闭房间失败: ${error.message}`);
        }
      }
    } else {
      // Non-host player leaving
      if (window.confirm("确定要退出当前房间吗？")) {
        try {
          const { error: deletePlayerError } = await supabase
            .from("room_players")
            .delete()
            .eq("room_id", roomId)
            .eq("user_id", currentUser.id);

          if (deletePlayerError) {
            throw deletePlayerError;
          }
          alert("您已退出房间。");
          router.push("/");
        } catch (error: any) {
          console.error("Error leaving room:", error);
          alert(`退出房间失败: ${error.message}`);
        }
      }
    }
  }, [currentUser, roomDetails, roomId, supabase, router]);

  const handleSelectSeat = useCallback(
    async (seatNumber: number) => {
      // myPlayerInfo here will be the derived one, so it's up-to-date.
      if (!currentUser || !roomDetails || roomDetails.status !== "lobby")
        return;
      // Check if user is already in the room and trying to change seat, or joining
      const isAlreadySeated = myPlayerInfo && myPlayerInfo.seat_number !== null;

      // Simple check: if user tries to select a seat when they are already seated,
      // it might mean changing seat (if allowed) or it's an erroneous click.
      // For now, let's assume selecting a seat means claiming an empty one.
      if (isAlreadySeated && myPlayerInfo?.seat_number !== seatNumber) {
        // If you want to allow changing seats, you'd handle that differently.
        // For now, if already seated, selecting another seat could be disallowed or handled.
        // console.log("Player already seated, attempting to change or select new seat.");
      }

      try {
        // If player is not in the room_players yet, first insert them
        if (!myPlayerInfo) {
          const { error: insertError } = await supabase
            .from("room_players")
            .insert({
              room_id: roomId,
              user_id: currentUser.id,
              is_alive: true,
              is_ready: false, // Will be not ready initially
              seat_number: seatNumber, // Assign seat directly
            });
          if (insertError) throw insertError;
        } else {
          // Player exists, update their seat
          const { error: updateError } = await supabase
            .from("room_players")
            .update({ seat_number: seatNumber, is_ready: false }) // Reset ready status on seat change
            .eq("room_id", roomId)
            .eq("user_id", currentUser.id);
          if (updateError) throw updateError;
        }
        // Realtime will handle UI updates by updating `players` list
      } catch (error: unknown) {
        console.error("Error selecting seat:", error);
        const errorMessage =
          error instanceof Error ? error.message : "Error selecting seat";
        alert(`选座失败: ${errorMessage}`);
      }
    },
    [currentUser, roomDetails, roomId, supabase, myPlayerInfo]
  );

  const handleReady = useCallback(async () => {
    // myPlayerInfo is derived, so it reflects the latest state from `players`
    console.log("handleReady called. myPlayerInfo:", myPlayerInfo);
    if (
      !myPlayerInfo ||
      myPlayerInfo.seat_number === null ||
      !roomDetails ||
      roomDetails.status !== "lobby" ||
      !currentUser
    ) {
      alert("请先选座并确保您已正确加入房间且房间处于大厅。");
      console.warn("Pre-conditions for handleReady not met:", {
        myPlayerInfo,
        roomDetails,
        currentUser,
      });
      return;
    }
    const newReadyState = !myPlayerInfo.is_ready;
    try {
      const { error } = await supabase
        .from("room_players")
        .update({ is_ready: newReadyState })
        .eq("room_id", roomId)
        .eq("user_id", currentUser.id); // Use currentUser.id for certainty
      if (error) throw error;
      // Realtime will update the `players` list, which will update `myPlayerInfo`,
      // and then the UI will re-render with the new ready state.
    } catch (error: unknown) {
      console.error("Error setting ready state:", error);
      const errorMessage =
        error instanceof Error ? error.message : "Error setting ready state";
      alert(`更新准备状态失败: ${errorMessage}`);
    }
  }, [myPlayerInfo, roomDetails, supabase, roomId, currentUser]);

  const handleStartGame = useCallback(async () => {
    if (
      !currentUser ||
      !roomDetails ||
      roomDetails.host_user_id !== currentUser.id ||
      roomDetails.status !== "lobby"
    )
      return;

    // Check conditions based on `players` state, which is the source of truth
    const canStart =
      players.length === 9 && // Example: Fixed 9 players
      players.every((p) => p.is_ready) &&
      players.every((p) => p.seat_number !== null);

    if (!canStart) {
      alert(
        "游戏开始条件未满足 (例如: 人数不足9人, 或有人未准备, 或有人未选座)。"
      );
      return;
    }

    console.log("房主尝试开始游戏");
    try {
      const response = await fetch(`/api/rooms/${roomId}/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // body: JSON.stringify({ roomId }), // if your API needs it
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.message || "Failed to start game");

      console.log("开始游戏请求成功，等待 Realtime 更新UI...");
    } catch (error: unknown) {
      console.error("Error starting game:", error);
      const errorMessage =
        error instanceof Error ? error.message : "Error starting game";
      alert(`开始游戏失败: ${errorMessage}`);
    }
  }, [currentUser, roomDetails, roomId, players]); // Added players dependency

  const handleJoinRoom = useCallback(async () => {
    if (!currentUser || !roomDetails || myPlayerInfo) {
      // Don't join if already in players list
      if (myPlayerInfo)
        console.log("User already in room, join attempt ignored.");
      return;
    }

    try {
      const { error } = await supabase.from("room_players").insert({
        room_id: roomId,
        user_id: currentUser.id,
        is_alive: true,
        is_ready: false,
        seat_number: null, // Will select seat later
      });

      if (error) {
        // Check for unique constraint violation if user already exists
        if (error.code === "23505") {
          // PostgreSQL unique violation error code
          console.warn("User already in room_players, fetching data again.");
          fetchInitialData(); // Attempt to re-sync
        } else {
          throw error;
        }
      }
      // Realtime should update players list, then myPlayerInfo
    } catch (error: unknown) {
      console.error("Error joining room:", error);
      const errorMessage =
        error instanceof Error ? error.message : "Error starting game";
      alert(`加入房间失败: ${errorMessage}`);
    }
  }, [
    currentUser,
    roomDetails,
    roomId,
    supabase,
    myPlayerInfo,
    fetchInitialData,
  ]);

  const getCurrentUserNickname = useCallback(() => {
    if (myPlayerInfo) return myPlayerInfo.nickname;
    if (currentUser) return currentUser.email || currentUser.id; // Fallback
    return "访客";
  }, [myPlayerInfo, currentUser]);

  const getHostNickname = useCallback(() => {
    if (!roomDetails) return "未知房主";
    const hostPlayer = players.find(
      (p) => p.user_id === roomDetails.host_user_id
    );
    return (
      hostPlayer?.nickname ||
      `房主(${roomDetails.host_user_id.substring(0, 6)}...)`
    );
  }, [players, roomDetails]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        正在加载房间信息...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen text-red-500">
        <p>错误: {error}</p>
        <button
          onClick={() => router.push("/")}
          className="mt-4 px-4 py-2 bg-blue-500 text-white rounded"
        >
          返回首页
        </button>
      </div>
    );
  }

  if (!roomDetails || !currentUser) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        无法加载房间或用户信息，请尝试刷新或重新登录。
      </div>
    );
  }

  // Prepare data for rendering lobby
  const unseatedPlayers = players.filter((p) => p.seat_number === null);
  const seatedPlayersMap = new Map<number, Player>();
  players.forEach((p) => {
    if (p.seat_number !== null) {
      seatedPlayersMap.set(p.seat_number, p);
    }
  });
  const seatArrayForRender = Array(9)
    .fill(null)
    .map((_, index) => {
      return seatedPlayersMap.get(index + 1) || null;
    });

  const renderLobby = () => (
    <div>
      <h2 className="text-2xl font-bold mb-4">
        房间大厅 (邀请码: {roomDetails.invite_code})
      </h2>
      <p>
        模式: {roomDetails.game_settings_choice === "A" ? "模式A" : "模式B"}
      </p>
      <p>房主: {getHostNickname()}</p>

      <h3 className="text-xl mt-6 mb-2">座位区 (点击选座)</h3>
      <div className="grid grid-cols-3 gap-4 mb-6">
        {seatArrayForRender.map((player, index) => {
          const seatNumber = index + 1;
          const isMySeat = myPlayerInfo?.seat_number === seatNumber;

          return (
            <button
              key={seatNumber}
              onClick={() => {
                // 只允许点击空座位
                if (!player) {
                  handleSelectSeat(seatNumber);
                }
                // 如果点击的是自己的座位，可以考虑做“取消选座”的逻辑，但目前需求是切换
              }}
              // 如果座位已被任何人占据，则禁用按钮
              disabled={!!player}
              className={`
                  p-4 border rounded h-24 flex flex-col items-center justify-center
                  transition-colors duration-150
                  ${
                    player
                      ? "bg-gray-300 text-gray-500" // 被占用的座位样式
                      : "bg-green-100 hover:bg-green-200 text-green-800 cursor-pointer" // 空座位样式
                  }
                  ${
                    isMySeat
                      ? "ring-2 ring-blue-500" // 我当前选择的座位高亮
                      : ""
                  }
                  // Tailwind CSS 会自动为 disabled 按钮应用一些样式，
                  // 你也可以用 'disabled:opacity-50 disabled:cursor-not-allowed' 来更明确地控制
                  disabled:opacity-60 disabled:cursor-not-allowed
                `}
            >
              <span className="font-bold text-lg">{seatNumber}号</span>
              {player ? (
                <>
                  <span>{player.nickname}</span>
                  {player.is_ready && (
                    <span className="text-xs text-green-700">(已准备)</span>
                  )}
                </>
              ) : (
                <span className="text-sm text-gray-500">(空位)</span>
              )}
            </button>
          );
        })}
      </div>

      {unseatedPlayers.length > 0 && (
        <div className="mb-4">
          <h4 className="text-md font-semibold">等待区:</h4>
          {unseatedPlayers.map((p) => (
            <span key={p.id} className="mr-2">
              {p.nickname}
            </span>
          ))}
        </div>
      )}

      {!myPlayerInfo && players.length < 9 && (
        <div className="mt-4">
          <p className="text-orange-500 mb-2">
            您当前不在该房间的玩家列表中，可以点击下方按钮加入或选择一个空座位。
          </p>
          <button
            onClick={handleJoinRoom}
            className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded mr-2"
          >
            快速加入(无座)
          </button>
          <span className="text-sm">或直接点击上方空位选座加入。</span>
        </div>
      )}

      {myPlayerInfo && myPlayerInfo.seat_number && (
        <div className="my-6 p-4 bg-gray-50 border rounded-lg">
          <p className="mb-2">
            您已入座 {myPlayerInfo.seat_number}号位，请准备开始游戏：
          </p>
          <button
            onClick={handleReady}
            className={`px-4 py-2 rounded ${
              myPlayerInfo.is_ready
                ? "bg-yellow-500 hover:bg-yellow-600"
                : "bg-green-500 hover:bg-green-600"
            } text-white`}
          >
            {myPlayerInfo.is_ready ? "取消准备" : "准备"}
          </button>
          <span className="ml-3 text-sm text-gray-600">
            {myPlayerInfo.is_ready ? "您已准备就绪" : "等待房主开始"}
          </span>
        </div>
      )}
      {myPlayerInfo && myPlayerInfo.seat_number === null && (
        <p className="text-yellow-600 mt-2">
          您已加入房间但尚未选座，请点击上方空位选择座位。
        </p>
      )}

      {roomDetails.host_user_id === currentUser.id && (
        <button
          onClick={handleStartGame}
          disabled={
            players.length < 9 || // Or whatever your min player count is
            players.some((p) => !p.is_ready) ||
            players.some((p) => p.seat_number === null)
          }
          className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded disabled:opacity-50"
        >
          开始游戏 ({players.filter((p) => p.is_ready).length}/
          {players.filter((p) => p.seat_number !== null).length} 人已准备, 共
          {players.length}人)
        </button>
      )}
      {!myPlayerInfo && players.length >= 9 && (
        <p className="text-red-500 mt-4">房间已满，您无法加入。</p>
      )}
    </div>
  );

  const renderNightPhase = () => (
    <div>
      <h2 className="text-2xl font-bold mb-4">
        夜晚阶段 - 第 {roomDetails.current_round_number} 夜
      </h2>
      {myPlayerInfo?.is_alive === false && (
        <p className="text-red-500">你已经死亡，请等待天亮。</p>
      )}
      {myPlayerInfo?.is_alive && (
        <>
          <p>你的身份: {myPlayerInfo.role || "等待分配..."}</p>
          {myPlayerInfo.role === "wolf" && (
            <div>
              <p>
                狼人同伴:{" "}
                {players
                  .filter(
                    (p) => p.role === "wolf" && p.user_id !== currentUser?.id
                  )
                  .map((p) => p.nickname)
                  .join(", ") || "无"}
              </p>
            </div>
          )}
          {myPlayerInfo.role === "seer" && nightActions.seerCheckedUser && (
            <p className="text-blue-500">
              查验结果: {nightActions.seerCheckedUser.userId} 是{" "}
              {nightActions.seerCheckedUser.role}
            </p>
          )}
        </>
      )}
    </div>
  );

  const renderDayPhase = () => (
    <div>
      <h2 className="text-2xl font-bold mb-4">
        白天阶段 - 第 {roomDetails.current_round_number} 天
      </h2>
    </div>
  );

  const renderGameFinished = () => (
    <div>
      <h2 className="text-2xl font-bold mb-4">游戏结束</h2>
      <p>
        胜利方:{" "}
        {roomDetails.winning_faction === "wolves" ? "狼人阵营" : "好人阵营"}
      </p>
      <h3 className="text-xl mt-4">玩家身份:</h3>
      <ul>
        {players.map((p) => (
          <li key={p.id}>
            {p.nickname} ({p.seat_number}号): {p.role}
          </li>
        ))}
      </ul>
      <button
        onClick={() => router.push("/")}
        className="mt-6 px-4 py-2 bg-blue-500 text-white rounded"
      >
        返回大厅
      </button>
    </div>
  );

  return (
    <div className="container mx-auto p-4 max-w-4xl">
      <div className="mb-6 p-4 bg-gray-100 rounded shadow">
          <p>房间ID: {roomId}</p>
          <p>当前状态: {roomDetails.status}</p>
          <p className="flex items-center">
            我的信息:{" "}
            <span className="font-medium ml-1">{getCurrentUserNickname()}</span>
            {myPlayerInfo && (
              <>
                <span className="mx-1">
                  ({myPlayerInfo.seat_number || "未入座"}号)
                </span>
                <span
                  className={`${
                    myPlayerInfo.is_alive ? "text-green-600" : "text-red-600"
                  }`}
                >
                  {myPlayerInfo.is_alive ? "(存活)" : "(死亡)"}
                </span>
                {myPlayerInfo.role && (
                  <span className="ml-1">[{myPlayerInfo.role}]</span>
                )}
              </>
            )}
          </p>
          <p>
            房主: <span className="font-medium">{getHostNickname()}</span>
            {currentUser.id === roomDetails.host_user_id && (
              <span className="text-xs bg-yellow-200 px-1 rounded ml-1">
                这是你
              </span>
            )}
          </p>
          {roomDetails.status !== 'finished' && roomDetails.status !== 'closed' && (
            <button
              onClick={handleLeaveRoom}
              className="mt-4 px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded text-sm"
            >
              {currentUser.id === roomDetails.host_user_id ? "退出并关闭房间" : "退出房间"}
            </button>
          )}
        </div>

      <div className="game-content p-4 border rounded bg-white shadow">
        {roomDetails.status === "lobby" && renderLobby()}
        {roomDetails.status === "in_game_night" && renderNightPhase()}
        {(roomDetails.status === "in_game_day_discussion" ||
          roomDetails.status === "in_game_day_vote") &&
          renderDayPhase()}
        {roomDetails.status === "finished" && renderGameFinished()}
      </div>
    </div>
  );
}
