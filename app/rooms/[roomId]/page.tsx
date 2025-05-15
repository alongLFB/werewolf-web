"use client"; // 这个页面会有大量交互和状态，所以是客户端组件

import { useEffect, useState, useCallback, useMemo } from "react";
import { useParams, useRouter } from "next/navigation"; // 使用 next/navigation
import { RealtimeChannel, User } from "@supabase/supabase-js";
import { createBrowserSupabaseClient } from "@/utils/supabase/client"; // 你的客户端 Supabase

// Define Player and GameRoom interfaces (ensure they are complete)
interface Player {
  id: string;
  user_id: string;
  nickname: string;
  seat_number: number | null;
  role?: string | null;
  is_alive: boolean;
  is_ready?: boolean;
  connection_status?: string;
  has_used_witch_save?: boolean; // Ensure this is populated
  has_used_witch_poison?: boolean; // Ensure this is populated
  is_candidate_for_sheriff?: boolean; // For police election
  voted_for_sheriff_candidate_id?: string | null; // For police election vote tracking
}

interface GameRoom {
  id: string;
  invite_code: string;
  host_user_id: string;
  status: string; // Will include "police_election", "day_results_announcement", "sheriff_sets_speech_order"
  game_settings_choice: "A" | "B";
  current_round_number: number;
  current_turn_player_id?: string | null;
  police_badge_holder_id?: string | null;
  speaker_order?: string[];
  winning_faction?: string | null;
  current_night_acting_role?: string | null;
  night_actions_log?: Record<number, any>; // More specific type if available
  game_start_config?: Record<string, any>; // More specific type if available
  // Election specific data, could be part of game_rooms or derived from room_players
  election_candidates_ids?: string[]; // user_ids of candidates, if stored directly on game_rooms
  last_night_deaths?: string[]; // user_ids of players who died last night
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

  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);
  const [isSubmittingAction, setIsSubmittingAction] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [selectedSheriffVote, setSelectedSheriffVote] = useState<string | null>(null);

  const [currentSpeakerIndex, setCurrentSpeakerIndex] = useState(0);
  const [speakingTimeLeft, setSpeakingTimeLeft] = useState(90); // 90 seconds for each speaker
  const [isSpeaking, setIsSpeaking] = useState(false);

  // const speakerOrder = roomDetails.speaker_order || []; // Assuming speaker_order is part of roomDetails
  const [speakerOrder, setSpeakerOrder] = useState<string[]>([]);
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

  useEffect(() => {
    if (isSpeaking) {
      const timer = setInterval(() => {
        setSpeakingTimeLeft((prev) => {
          if (prev <= 1) {
            clearInterval(timer);
            setIsSpeaking(false);
            setCurrentSpeakerIndex((prevIndex) => prevIndex + 1);
            return 90; // Reset time for the next speaker
          }
          return prev - 1;
        });
      }, 1000);
      return () => clearInterval(timer);
    }
  }, [isSpeaking]);

  const startSpeaking = () => {
    console.log("startSpeaking", currentSpeakerIndex, roomDetails.speakerOrder?.length);
    if (currentSpeakerIndex < roomDetails.speakerOrder?.length) {
      setIsSpeaking(true);
    } else {
      // Transition to daytime voting phase
      // Assuming there's a function to handle this transition
      // handleTransitionToVotingPhase();
    }
  };

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
        (p: { user_id: string; seat_number: number | null; role?: string | null; is_alive: boolean; is_ready?: boolean; connection_status?: string; profile: { nickname: string } }) =>
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
            const newRoomData = payload.new as GameRoom;
            setRoomDetails((prev) => ({
              ...prev,
              ...(payload.new as GameRoom),
            }));
            setSpeakerOrder(newRoomData.speaker_order || []);
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
  }, [roomId, supabase, currentUser]); // currentUser and roomChannel are essential here

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
        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error.message : "Error closing room";
          console.error("Error closing room:", errorMessage);
          alert(`关闭房间失败: ${errorMessage}`);
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
        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error.message : "Error closing room";
          console.error("Error leaving room:", errorMessage);
          alert(`退出房间失败: ${errorMessage}`);
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

  const handleWolfKill = useCallback(async (targetId: string | null) => {
    if (!roomId || !myPlayerInfo || myPlayerInfo.role !== "wolf" || isSubmittingAction) return;
    if (!targetId) {
      // This could be a "no kill" decision if your API supports it, or just do nothing.
      // For now, we assume a targetId is required to call the API.
      // If wolves collectively decide not to kill, one wolf can submit with a special target or the server handles timeouts.
      alert("请选择一个目标。");
      return;
    }
    setIsSubmittingAction(true);
    setActionError(null);
    try {
      const response = await fetch(`/api/rooms/${roomId}/night/wolf-kill`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetUserId: targetId }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "狼人行动失败");
      // alert("狼人目标已提交。"); // Server will advance phase
      setSelectedTargetId(null); // Reset selection
    } catch (error: any) {
      console.error("Error during wolf kill:", error);
      setActionError(error.message);
      alert(`狼人行动出错: ${error.message}`);
    } finally {
      setIsSubmittingAction(false);
    }
  }, [roomId, myPlayerInfo, isSubmittingAction]);

  const handleSeerCheck = useCallback(async (targetId: string | null) => {
    if (!roomId || !myPlayerInfo || myPlayerInfo.role !== "seer" || isSubmittingAction) return;
    // If targetId is null, it means seer is skipping (e.g. due to timeout)
    // The API should handle targetUserId: null if that's a valid "skip" action,
    // or the client just doesn't call if no target is selected by user.
    // The current seer-check API requires a targetUserId.
    // For timeout skip, we might need a different API or logic.
    // For now, if targetId is null, we assume it's a deliberate skip and don't call API if API needs target.
    // However, the timeout logic above calls this with null.
    // Let's assume for now the API is called, and if targetId is null, it's a "no check".
    // The provided API route for seer requires targetUserId. So a null targetId here means no API call unless user selected.
    // If it's a timeout, the server should advance. For manual skip, a button could not call API.
    // Let's adjust: if targetId is null from timeout, we don't call. User must select.
    if (!targetId && roomDetails?.current_night_acting_role === "seer") {
        // This case is for timeout where no target was selected.
        // The server should ideally handle phase progression.
        // To make the client advance, we could call a generic "skip_turn" API if one existed.
        // For now, if seer times out without selection, nothing is sent.
        console.log("Seer timed out without selection.");
        // To ensure phase moves, a "skip" action could be sent to a modified API.
        // Or, the server has its own master timer for phases.
        // For now, we'll assume the server handles phase advancement on timeout.
        // If the user clicks "skip", that's different.
        // Let's assume the API will be called and handle it, or we add a skip button.
        // The current API requires targetUserId.
        // So, if targetId is null, we can't call it.
        // The timeout logic should be rethought if client must inform server of skip.
        // For now, if targetId is null, it means the seer chose not to check or timed out.
        // The server should eventually move the phase.
        // If the user explicitly clicks a "Skip" button, that's a different flow.
        // Let's assume the API is robust or there's a server-side timeout.
        // For this client, if targetId is null, we just log it.
        if (!targetId) {
            console.log("预言家选择不查验或已超时。");
            // To make the game progress, the server needs to advance the phase.
            // This client cannot force it without an API call.
            // A "dummy" call or a specific "skip" API endpoint would be needed.
            // For now, we assume the server has a master timer.
            // If the API is updated to accept a "skip", then we can call it.
            // Let's assume for now, if targetId is null, no API call is made.
            // The server will eventually move to the next phase.
            // To make the UI reflect this, we can simulate the phase change or wait for server.
            // This is tricky without a server-side master timer or a "skip" API.
            // Let's assume the user MUST select someone or the server times out the phase.
            // The timeout handler above calls this with null.
            // If targetId is null, we can't call the current API.
            // This means the timeout logic needs to be more robust or server handles it.
            // For now, if targetId is null, we do nothing.
            if (!targetId) {
                 alert("请选择一个查验目标。");
                 return;
            }
        }
    }
    setIsSubmittingAction(true);
    setActionError(null);
    try {
      const response = await fetch(`/api/rooms/${roomId}/night/seer-check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetUserId: targetId }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "预言家查验失败");
      // Result (roleChecked) is sent via broadcast "night_action_result" and updates `nightActions.seerCheckedUser`
      // alert(`查验结果: ${result.checkedUserId} 是 ${result.roleChecked}`); // Don't alert, use nightActions
      setSelectedTargetId(null);
    } catch (error: any) {
      console.error("Error during seer check:", error);
      setActionError(error.message);
      alert(`预言家查验出错: ${error.message}`);
    } finally {
      setIsSubmittingAction(false);
    }
  }, [roomId, myPlayerInfo, isSubmittingAction, roomDetails?.current_night_acting_role]);

  const handleWitchAction = useCallback(async (actionType: "save" | "poison" | "skip", targetId?: string | null) => {
    if (!roomId || !myPlayerInfo || myPlayerInfo.role !== "witch" || isSubmittingAction) return;
    if (actionType === "poison" && !targetId) {
      alert("使用毒药请选择一个目标。");
      return;
    }

    setIsSubmittingAction(true);
    setActionError(null);
    try {
      const payload: { actionType: string; targetUserId?: string | null } = { actionType };
      if (actionType === "poison" && targetId) {
        payload.targetUserId = targetId;
      }

      const response = await fetch(`/api/rooms/${roomId}/night/witch-action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "女巫行动失败");
      // alert(result.message); // Server will advance phase
      setSelectedTargetId(null); // Reset selection
      // Potions status (has_used_witch_save, etc.) will be updated via Realtime on room_players table
    } catch (error: any) {
      console.error("Error during witch action:", error);
      setActionError(error.message);
      alert(`女巫行动出错: ${error.message}`);
    } finally {
      setIsSubmittingAction(false);
    }
  }, [roomId, myPlayerInfo, isSubmittingAction]);

  useEffect(() => {
    if (
      !roomDetails ||
      roomDetails.status !== "in_game_night" ||
      !myPlayerInfo?.is_alive ||
      roomDetails.current_night_acting_role !== myPlayerInfo.role
    ) {
      setTimeLeft(null);
      setSelectedTargetId(null);
      return;
    }

    let duration = 0;
    const currentRoleAction = roomDetails.current_night_acting_role;

    if (currentRoleAction === "wolf" && myPlayerInfo.role === "wolf") {
      duration = 90;
    } else if (currentRoleAction === "seer" && myPlayerInfo.role === "seer") {
      duration = 60;
    } else if (currentRoleAction === "witch" && myPlayerInfo.role === "witch") {
      duration = 60;
    }

    if (duration > 0) {
      setTimeLeft(duration);
      const intervalId = setInterval(() => {
        setTimeLeft((prevTime) => {
          if (prevTime === null || prevTime <= 1) {
            clearInterval(intervalId);
            if (myPlayerInfo?.is_alive && roomDetails.current_night_acting_role === myPlayerInfo.role && !isSubmittingAction) {
              console.log(`${myPlayerInfo.role} action timed out. Attempting to skip.`);
              if (myPlayerInfo.role === "wolf") {
                // No client-side skip for wolf unless API supports it
              } else if (myPlayerInfo.role === "seer") {
                // handleSeerCheck(null); // API requires targetId, server should handle timeout
                console.log("Seer timed out, server should advance phase.");
              } else if (myPlayerInfo.role === "witch") {
                handleWitchAction("skip", null); // Witch API supports skip
              }
            }
            return 0;
          }
          return prevTime - 1;
        });
      }, 1000);
      return () => clearInterval(intervalId);
    } else {
      setTimeLeft(null);
    }
  }, [
    roomDetails?.status,
    roomDetails?.current_night_acting_role,
    myPlayerInfo, // Use the whole object as its properties (role, is_alive) are used
    roomId,
    handleSeerCheck, // Add handlers to dependency array
    handleWitchAction, // Add handlers to dependency array
    isSubmittingAction, // To prevent timeout action if already submitting
  ]);

  const electionCandidates = useMemo(() => {
    return players.filter(p => p.is_alive && p.is_candidate_for_sheriff);
  }, [players]);


  const handleRunForSheriff = useCallback(async () => {
    if (!roomId || !myPlayerInfo || !myPlayerInfo.is_alive || isSubmittingAction || myPlayerInfo.is_candidate_for_sheriff) {
      if (myPlayerInfo?.is_candidate_for_sheriff) alert("你已经是候选人了。");
      return;
    }
    setIsSubmittingAction(true);
    setActionError(null);
    try {
      const response = await fetch(`/api/rooms/${roomId}/election/run-for-sheriff`, { method: "POST" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "参选警长失败");
      // Realtime update on room_players.is_candidate_for_sheriff will refresh `electionCandidates`
      alert("你已成功参选警长！");
    } catch (error: any) {
      setActionError(error.message);
      alert(`参选警长出错: ${error.message}`);
    } finally {
      setIsSubmittingAction(false);
    }
  }, [roomId, myPlayerInfo, isSubmittingAction]);

  const handleVoteForSheriff = useCallback(async (candidateUserId: string | null) => {
    if (!roomId || !myPlayerInfo || !myPlayerInfo.is_alive || isSubmittingAction || !candidateUserId) {
      if (!candidateUserId) alert("请选择一位候选人。");
      return;
    }
    if (myPlayerInfo.voted_for_sheriff_candidate_id) {
        alert("你已经投过票了。");
        return;
    }
    setIsSubmittingAction(true);
    setActionError(null);
    try {
      const response = await fetch(`/api/rooms/${roomId}/election/vote-for-sheriff`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidateUserId }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "投票失败");
      // Realtime update on room_players.voted_for_sheriff_candidate_id
      alert(`投票成功。等待结果...`);
      setSelectedSheriffVote(null);
    } catch (error: any) {
      setActionError(error.message);
      alert(`投票出错: ${error.message}`);
    } finally {
      setIsSubmittingAction(false);
    }
  }, [roomId, myPlayerInfo, isSubmittingAction]);

  const handleProcessElectionAndDeaths = useCallback(async () => {
    // This would typically be called by the host, or automatically by the server after voting.
    if (!roomId || !myPlayerInfo || roomDetails?.host_user_id !== myPlayerInfo.user_id || isSubmittingAction) {
        // alert("只有房主可以结束投票并公布结果。"); // Or server handles this automatically
        return;
    }
    setIsSubmittingAction(true);
    try {
        const response = await fetch(`/api/rooms/${roomId}/election/process-results`, { method: "POST" });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || "处理选举结果失败");
        // Server will change game_rooms.status to "day_results_announcement" or "sheriff_sets_speech_order"
        // and update police_badge_holder_id, last_night_deaths. Realtime will update UI.
    } catch (error: any) {
        console.error("Error processing election results:", error);
        alert(`处理选举结果失败: ${error.message}`);
    } finally {
        setIsSubmittingAction(false);
    }
  }, [roomId, myPlayerInfo, roomDetails, isSubmittingAction]);

  const handleStartSetSpeechOrder = useCallback(async () => {
    if (!roomId || !myPlayerInfo || roomDetails?.host_user_id !== myPlayerInfo.user_id || isSubmittingAction) return;
    
    try {
        const response = await fetch(`/api/rooms/${roomId}/game/proceed-to-sheriff-order`, { method: "POST" });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || "跳到警长设置发言顺序失败");
    } catch (error: any) {
        console.error("Error processing election results:", error);
        alert(`跳到警长设置发言顺序失败: ${error.message}`);
    } finally {
        
    }
  }, [roomId, myPlayerInfo, roomDetails, isSubmittingAction]);

  const handleSetSpeechOrder = useCallback(async (direction: "clockwise" | "counter_clockwise") => {
    if (!roomId || !myPlayerInfo || roomDetails?.police_badge_holder_id !== myPlayerInfo.user_id || isSubmittingAction) return;
    setIsSubmittingAction(true);
    try {
        const response = await fetch(`/api/rooms/${roomId}/sheriff/set-speech-order`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ direction }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || "设置发言顺序失败");
        // Server will transition to day_discussion. Realtime updates UI.
    } catch (error: any) {
        console.error("Error setting speech order:", error);
        alert(`设置发言顺序失败: ${error.message}`);
    } finally {
        setIsSubmittingAction(false);
    }
  }, [roomId, myPlayerInfo, roomDetails, isSubmittingAction]);

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
          onClick={() => router.refresh()}
          className="mt-4 px-4 py-2 bg-blue-500 text-white rounded"
        >
          刷新页面
        </button>
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

    const renderNightPhase = () => {
    if (!myPlayerInfo || !roomDetails) return <p>等待夜晚信息...</p>;

    const alivePlayers = players.filter((p) => p.is_alive);
    const potentialTargetsForWolf = alivePlayers.filter(
      (p) => p.role !== "wolf" && p.user_id !== myPlayerInfo.user_id // Wolves typically can't target each other, or self
    );
    const potentialTargetsForSeer = alivePlayers.filter(
      (p) => p.user_id !== myPlayerInfo.user_id
    );
     const potentialTargetsForWitchPoison = alivePlayers.filter(
      (p) => p.user_id !== myPlayerInfo.user_id
    );

    // Get wolf target from night_actions_log for the witch
    let wolfTargetForWitchInfo: Player | null = null;
    if (myPlayerInfo.role === 'witch' && roomDetails.night_actions_log) {
        const currentRoundLog = roomDetails.night_actions_log[roomDetails.current_round_number];
        if (currentRoundLog && currentRoundLog.wolf_kill_target) {
            wolfTargetForWitchInfo = players.find(p => p.user_id === currentRoundLog.wolf_kill_target) || null;
        }
    }
    const witchHasSave = myPlayerInfo.role === 'witch' && !myPlayerInfo.has_used_witch_save;
    const witchHasPoison = myPlayerInfo.role === 'witch' && !myPlayerInfo.has_used_witch_poison;
    // Witch self-save rule (example, assuming game_start_config is available and structured)
    // const gameConfig = roomDetails.game_start_config as { witch_can_self_save_first_night?: boolean } | undefined;
    // const canWitchSelfSaveThisRound = !(roomDetails.current_round_number === 1 &&
    //                                   wolfTargetForWitchInfo?.user_id === myPlayerInfo.user_id &&
    //                                   gameConfig?.witch_can_self_save_first_night === false);


    return (
      <div>
        <h2 className="text-2xl font-bold mb-4">
          夜晚阶段 - 第 {roomDetails.current_round_number} 夜
        </h2>
        {timeLeft !== null && roomDetails.current_night_acting_role === myPlayerInfo.role && (
          <p className="text-xl font-semibold text-orange-500 mb-4">
            行动倒计时: {timeLeft} 秒
          </p>
        )}
        {actionError && <p className="text-red-500 mb-2">错误: {actionError}</p>}

        {myPlayerInfo?.is_alive === false && (
          <p className="text-red-500">你已经死亡，请等待天亮。</p>
        )}

        {myPlayerInfo?.is_alive && (
          <>
            <p className="mb-2">你的身份: <span className="font-semibold">{myPlayerInfo.role || "等待分配..."}</span></p>

            {/* Wolf Action UI */}
            {myPlayerInfo.role === "wolf" && roomDetails.current_night_acting_role === "wolf" && (
              <div className="p-4 border rounded bg-red-50">
                <h3 className="text-lg font-semibold text-red-700 mb-2">狼人行动：请选择袭击目标</h3>
                <p className="mb-2">
                  狼人同伴:{" "}
                  {players
                    .filter(
                      (p) => p.role === "wolf" && p.user_id !== currentUser?.id && p.is_alive
                    )
                    .map((p) => p.nickname)
                    .join(", ") || "无存活同伴"}
                </p>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mb-3">
                  {potentialTargetsForWolf.map((p) => (
                    <button
                      key={p.user_id}
                      onClick={() => setSelectedTargetId(p.user_id)}
                      disabled={isSubmittingAction}
                      className={`p-2 border rounded text-sm ${
                        selectedTargetId === p.user_id
                          ? "bg-red-500 text-white ring-2 ring-red-700"
                          : "bg-white hover:bg-red-100"
                      } disabled:opacity-50`}
                    >
                      {p.seat_number}号 - {p.nickname}
                    </button>
                  ))}
                </div>
                {potentialTargetsForWolf.length === 0 && <p className="text-sm text-gray-600 mb-2">没有可攻击的目标。</p>}
                <button
                  onClick={() => handleWolfKill(selectedTargetId)}
                  disabled={!selectedTargetId || isSubmittingAction}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded disabled:opacity-50"
                >
                  {isSubmittingAction ? "提交中..." : "确认袭击"}
                </button>
              </div>
            )}

            {/* Seer Action UI */}
            {myPlayerInfo.role === "seer" && roomDetails.current_night_acting_role === "seer" && (
              <div className="p-4 border rounded bg-blue-50">
                <h3 className="text-lg font-semibold text-blue-700 mb-2">预言家行动：请选择查验对象</h3>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mb-3">
                  {potentialTargetsForSeer.map((p) => (
                    <button
                      key={p.user_id}
                      onClick={() => setSelectedTargetId(p.user_id)}
                      disabled={isSubmittingAction}
                      className={`p-2 border rounded text-sm ${
                        selectedTargetId === p.user_id
                          ? "bg-blue-500 text-white ring-2 ring-blue-700"
                          : "bg-white hover:bg-blue-100"
                      } disabled:opacity-50`}
                    >
                      {p.seat_number}号 - {p.nickname}
                    </button>
                  ))}
                </div>
                 {potentialTargetsForSeer.length === 0 && <p className="text-sm text-gray-600 mb-2">没有可查验的目标。</p>}
                <button
                  onClick={() => handleSeerCheck(selectedTargetId)}
                  disabled={!selectedTargetId || isSubmittingAction}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded disabled:opacity-50"
                >
                  {isSubmittingAction ? "查验中..." : "确认查验"}
                </button>
                {nightActions.seerCheckedUser && (
                  <p className="mt-3 text-blue-600 font-semibold">
                    查验结果: 玩家 {players.find(p=>p.user_id === nightActions.seerCheckedUser?.userId)?.nickname || nightActions.seerCheckedUser?.userId} 的阵营是{" "}
                    <span className="uppercase">{nightActions.seerCheckedUser.role === "wolf" ? "狼人" : "好人"}</span>.
                  </p>
                )}
              </div>
            )}

            {/* Witch Action UI */}
            {myPlayerInfo.role === "witch" && roomDetails.current_night_acting_role === "witch" && (
              <div className="p-4 border rounded bg-purple-50">
                <h3 className="text-lg font-semibold text-purple-700 mb-2">女巫行动</h3>
                <p className="mb-1">解药剩余: {witchHasSave ? "1" : "0"} 瓶</p>
                <p className="mb-3">毒药剩余: {witchHasPoison ? "1" : "0"} 瓶</p>

                {wolfTargetForWitchInfo ? (
                    <p className="mb-2 text-orange-600">今晚被袭击的是: {wolfTargetForWitchInfo.seat_number}号 - {wolfTargetForWitchInfo.nickname}</p>
                ) : (
                    <p className="mb-2 text-green-600">今晚无人被狼人袭击 (或狼人未行动)。</p>
                )}

                <div className="space-y-3">
                  {/* Save Potion */}
                  {witchHasSave && wolfTargetForWitchInfo && (
                    // Add self-save rule check if needed: && canWitchSelfSaveThisRound
                    <div>
                      <button
                        onClick={() => handleWitchAction("save")}
                        disabled={isSubmittingAction}
                        className="w-full px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded disabled:opacity-50"
                      >
                        {isSubmittingAction ? "处理中..." : `使用解药救 ${wolfTargetForWitchInfo.nickname}`}
                      </button>
                    </div>
                  )}
                  {!witchHasSave && wolfTargetForWitchInfo && <p className="text-sm text-gray-500">你已使用过解药。</p>}


                  {/* Poison Potion */}
                  {witchHasPoison && (
                    <div>
                      <h4 className="text-md font-semibold mb-1">使用毒药:</h4>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mb-2">
                        {potentialTargetsForWitchPoison
                          .filter(p => !(myPlayerInfo.role === 'witch' && wolfTargetForWitchInfo?.user_id === p.user_id && witchHasSave && selectedTargetId === null)) // Basic: don't show saved player if save is an option and not yet chosen for poison
                          .map((p) => (
                          <button
                            key={p.user_id}
                            onClick={() => setSelectedTargetId(p.user_id)}
                            disabled={isSubmittingAction}
                            className={`p-2 border rounded text-sm ${
                              selectedTargetId === p.user_id
                                ? "bg-purple-500 text-white ring-2 ring-purple-700"
                                : "bg-white hover:bg-purple-100"
                            } disabled:opacity-50`}
                          >
                            {p.seat_number}号 - {p.nickname}
                          </button>
                        ))}
                      </div>
                      {potentialTargetsForWitchPoison.length === 0 && <p className="text-sm text-gray-600 mb-2">没有可下毒的目标。</p>}
                      <button
                        onClick={() => handleWitchAction("poison", selectedTargetId)}
                        disabled={!selectedTargetId || isSubmittingAction}
                        className="w-full px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded disabled:opacity-50"
                      >
                        {isSubmittingAction ? "处理中..." : "确认使用毒药"}
                      </button>
                    </div>
                  )}
                   {!witchHasPoison && <p className="text-sm text-gray-500">你已使用过毒药。</p>}


                  {/* Skip Button */}
                  <div>
                    <button
                      onClick={() => handleWitchAction("skip")}
                      disabled={isSubmittingAction}
                      className="w-full mt-2 px-4 py-2 bg-gray-400 hover:bg-gray-500 text-white rounded disabled:opacity-50"
                    >
                      {isSubmittingAction ? "处理中..." : "跳过本回合"}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Message for roles whose turn it isn't or who have acted */}
            {myPlayerInfo.is_alive && roomDetails.current_night_acting_role !== myPlayerInfo.role && roomDetails.status === "in_game_night" && (
                 <p className="mt-4 text-gray-700">等待其他玩家行动... 当前行动角色: <span className="font-semibold">{roomDetails.current_night_acting_role || '未知'}</span></p>
            )}
             {myPlayerInfo.is_alive && roomDetails.current_night_acting_role === myPlayerInfo.role && timeLeft === 0 && !isSubmittingAction && (
                 <p className="mt-4 text-orange-600">时间到！等待服务器处理或进入下一阶段。</p>
            )}


          </>
        )}
      </div>
    );
  };

  const renderPoliceElectionPhase = () => {
    if (!myPlayerInfo || !roomDetails) return <p>等待警长竞选信息...</p>;

    const canRun = myPlayerInfo.is_alive && !myPlayerInfo.is_candidate_for_sheriff;
    // Voting conditions: alive, not yet voted, and there are candidates.
    // Add a server-driven flag like `roomDetails.election_voting_open` if candidacy declaration is a separate step.
    const canVote = myPlayerInfo.is_alive && !myPlayerInfo.voted_for_sheriff_candidate_id && electionCandidates.length > 0;

    return (
      <div className="p-4 border rounded bg-yellow-50">
        <h2 className="text-2xl font-bold mb-4">警长竞选 - 第 {roomDetails.current_round_number} 天</h2>
        {actionError && <p className="text-red-500 mb-2">错误: {actionError}</p>}

        {myPlayerInfo.is_alive ? (
          <>
            <div className="mb-4">
              <h3 className="text-lg font-semibold mb-1">竞选发言</h3>
              {canRun && (
                <button onClick={handleRunForSheriff} disabled={isSubmittingAction} className="px-4 py-2 bg-orange-500 text-white rounded disabled:opacity-50">
                  我要竞选警长
                </button>
              )}
              {myPlayerInfo.is_candidate_for_sheriff && <p className="text-green-600">你已参选警长。</p>}
            </div>

            {electionCandidates.length > 0 ? (
              <div className="mb-4">
                <h3 className="text-lg font-semibold mb-1">当前候选人:</h3>
                <ul className="list-disc list-inside pl-5">
                  {electionCandidates.map(p => <li key={p.user_id}>{p.seat_number}号 - {p.nickname}</li>)}
                </ul>
              </div>
            ) : <p className="mb-4">目前无人竞选警长。</p>}

            {canVote && (
              <div>
                <h3 className="text-lg font-semibold mb-1">投票给警长:</h3>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mb-3">
                  {electionCandidates.map(candidate => (
                    <button
                      key={candidate.user_id}
                      onClick={() => setSelectedSheriffVote(candidate.user_id)}
                      disabled={isSubmittingAction}
                      className={`p-2 border rounded ${selectedSheriffVote === candidate.user_id ? 'bg-blue-500 text-white' : 'bg-white hover:bg-blue-100'}`}
                    >
                      {candidate.seat_number}号 - {candidate.nickname}
                    </button>
                  ))}
                </div>
                <button onClick={() => handleVoteForSheriff(selectedSheriffVote)} disabled={!selectedSheriffVote || isSubmittingAction} className="px-4 py-2 bg-green-600 text-white rounded disabled:opacity-50">
                  确认投票
                </button>
              </div>
            )}
            {myPlayerInfo.voted_for_sheriff_candidate_id && <p className="text-green-700 mt-2">你已投票。</p>}
            {/* Host button to finalize election and proceed (or server does it automatically) */}
            {roomDetails.host_user_id === currentUser?.id && electionCandidates.length > 0 && (
                <button onClick={handleProcessElectionAndDeaths} disabled={isSubmittingAction} className="mt-4 px-4 py-2 bg-indigo-600 text-white rounded disabled:opacity-50">
                    结束投票并公布结果
                </button>
            )}
          </>
        ) : <p className="text-red-500">你已经死亡，无法参与警长竞选。</p>}
      </div>
    );
  };

  const renderDayResultsAnnouncementPhase = () => {
    if (!roomDetails) return <p>等待结果公布...</p>;
    const sheriff = players.find(p => p.user_id === roomDetails.police_badge_holder_id);
    const deathsLastNight = roomDetails.last_night_deaths?.map(userId => players.find(p => p.user_id === userId)?.nickname || `玩家ID ${userId.substring(0,6)}`).join(', ') || "无人死亡";

    return (
      <div className="p-4 border rounded bg-gray-50">
        <h2 className="text-2xl font-bold mb-4">昨夜结果 - 第 {roomDetails.current_round_number} 天</h2>
        <p className="mb-2"><strong>警长:</strong> {sheriff ? `${sheriff.seat_number}号 - ${sheriff.nickname}` : "尚未选出或平票"}</p>
        <p className="mb-2"><strong>昨夜死亡:</strong> {deathsLastNight}</p>
        {/* Server should automatically transition or host proceeds */}
        {/* If sheriff needs to set speech order, this phase transitions to `sheriff_sets_speech_order` */}
        {/* If no sheriff or sheriff action not needed, transitions to `in_game_day_discussion` */}
         {roomDetails.host_user_id === currentUser?.id && roomDetails.police_badge_holder_id && ( // Example: Host proceeds if sheriff exists
            <button onClick={handleStartSetSpeechOrder} className="mt-4 px-4 py-2 bg-blue-500 text-white rounded">
                进入警长决定发言顺序
            </button>
        )}
         {roomDetails.host_user_id === currentUser?.id && !roomDetails.police_badge_holder_id && (
             <button onClick={async () => { /* Call API to move to day_discussion directly */
                alert("房主操作：直接进入白天讨论（需API实现）");
             }} className="mt-4 px-4 py-2 bg-blue-500 text-white rounded">
                进入白天讨论
            </button>
         )}
      </div>
    );
  };

  const renderSheriffSetsSpeechOrderPhase = () => {
    if (!myPlayerInfo || !roomDetails || roomDetails.police_badge_holder_id !== myPlayerInfo.user_id) {
      const sheriff = players.find(p => p.user_id === roomDetails.police_badge_holder_id);
      return <p>等待警长 ({sheriff?.nickname || "未知"}) 决定发言顺序...</p>;
    }
    return (
      <div className="p-4 border rounded bg-teal-50">
        <h2 className="text-2xl font-bold mb-4">警长决定发言顺序</h2>
        <p className="mb-3">你是警长，请选择本轮发言顺序：</p>
        <button onClick={() => handleSetSpeechOrder("clockwise")} disabled={isSubmittingAction} className="mr-2 px-4 py-2 bg-teal-500 text-white rounded disabled:opacity-50">
          从你开始顺时针发言
        </button>
        <button onClick={() => handleSetSpeechOrder("counter_clockwise")} disabled={isSubmittingAction} className="px-4 py-2 bg-teal-500 text-white rounded disabled:opacity-50">
          从你开始逆时针发言
        </button>
      </div>
    );
  };

  const renderDayPhase = () => (
    <div>
      <h2 className="text-2xl font-bold mb-4">
        白天阶段 - 第 {roomDetails.current_round_number} 天
      </h2>
      {roomDetails.speaker_order?.length > 0 ? (
        <div>
          <p>当前发言者: {speakerOrder[currentSpeakerIndex]}</p>
          {isSpeaking ? (
            <p>发言时间剩余: {speakingTimeLeft} 秒</p>
          ) : (
            <button onClick={startSpeaking} className="px-4 py-2 bg-blue-500 text-white rounded">
              开始发言
            </button>
          )}
        </div>
      ) : (
        <p>没有发言者。</p>
      )}
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
          <h2 className="text-2xl font-bold mb-4">房间ID: {roomId} (邀请码: {roomDetails.invite_code})</h2>
          <p>
            模式: {roomDetails.game_settings_choice === "A" ? "模式A" : "模式B"}
          </p>
          <p>当前状态: {roomDetails.status}</p>
          <p>
            房主: <span className="font-medium">{getHostNickname()}</span>
            {currentUser.id === roomDetails.host_user_id && (
              <span className="text-xs bg-yellow-200 px-1 rounded ml-1">
                这是你
              </span>
            )}
          </p>
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
        {roomDetails.status === "police_election" && renderPoliceElectionPhase()}
        {roomDetails.status === "day_results_announcement" && renderDayResultsAnnouncementPhase()}
        {roomDetails.status === "sheriff_sets_speech_order" && renderSheriffSetsSpeechOrderPhase()}
        {(roomDetails.status === "in_game_day_discussion" || roomDetails.status === "in_game_day_vote") && renderDayPhase()}
        {roomDetails.status === "finished" && renderGameFinished()}
      </div>
    </div>
  );
}
