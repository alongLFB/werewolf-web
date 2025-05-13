"use client"; // 这个页面会有大量交互和状态，所以是客户端组件

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation'; // 使用 next/navigation
import { RealtimeChannel, User } from '@supabase/supabase-js';
import { createBrowserSupabaseClient } from '@/utils/supabase/client'; // 你的客户端 Supabase
// import GameBoard from '@/components/GameBoard'; // 你可能会把游戏主界面抽成组件
// import PlayerList from '@/components/PlayerList';
// import ChatBox from '@/components/ChatBox'; // 如果有聊天功能
// import GameControls from '@/components/GameControls'; // 各种游戏操作按钮

// 定义可能的游戏状态和玩家信息类型 (根据你的数据库表结构调整)
interface Player {
  id: string; // user_id from room_players which references profiles.id
  user_id: string;
  nickname: string; // 你需要从 profiles 表获取或在 room_players 中冗余
  seat_number: number | null;
  role?: string | null; // 只有自己能看到，或者游戏结束后公开
  is_alive: boolean;
  is_ready?: boolean; // 大厅状态
  connection_status?: string;
  // ... 其他你需要的玩家信息
}

interface GameRoom {
  id: string; // room_id
  invite_code: string;
  host_user_id: string;
  status: string; // 'lobby', 'dealing', 'in_game_night', 'in_game_day_discussion', etc.
  game_settings_choice: 'A' | 'B';
  current_round_number: number;
  current_turn_player_id?: string | null; // 当前行动/发言玩家
  police_badge_holder_id?: string | null;
  speaker_order?: string[]; // user_id 数组
  winning_faction?: string | null;
  // ... 其他房间信息
}

interface NightActions { // 用于跟踪夜间行动
  wolfTarget?: string | null; // 狼人选择的目标 user_id
  seerCheckedUser?: { userId: string, role: 'wolf' | 'good' } | null; // 预言家查验结果
  // ... 其他夜间行动结果
}

export default function RoomPage() {
  const params = useParams();
  const router = useRouter();
  const supabase = createBrowserSupabaseClient();

  const roomId = params.roomId as string; // 从动态路由获取房间ID

  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [roomDetails, setRoomDetails] = useState<GameRoom | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [myPlayerInfo, setMyPlayerInfo] = useState<Player | null>(null); // 当前登录用户在此房间的信息
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [gameLog, setGameLog] = useState<string[]>([]); // 游戏日志/事件
  const [nightActions, setNightActions] = useState<NightActions>({}); // 夜间行动私密信息

  // 实时订阅的 channel
  const [roomChannel, setRoomChannel] = useState<RealtimeChannel | null>(null);

  // 获取当前用户信息
  useEffect(() => {
    const getUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setCurrentUser(user);
      if (!user) {
        router.push(`/login?message=Please login to access rooms&redirectedFrom=/rooms/${roomId}`);
      }
    };
    getUser();
  }, [supabase, router, roomId]);


  // 获取房间和玩家初始数据
  const fetchInitialData = useCallback(async () => {
    if (!currentUser || !roomId) return;
    setIsLoading(true);
    setError(null);

    try {
      // 1. 获取房间详情
      const { data: roomData, error: roomError } = await supabase
        .from('game_rooms')
        .select('*')
        .eq('id', roomId)
        .single();

      if (roomError || !roomData) {
        throw new Error(roomError?.message || 'Room not found or unable to fetch room details.');
      }
      setRoomDetails(roomData as GameRoom);

      // 2. 获取房间内所有玩家信息 (结合 profiles 表获取昵称等)
      const { data: playersData, error: playersError } = await supabase
        .from('room_players')
        .select(`
          *,
          profile:profiles ( nickname )
        `) // 假设 profiles 表关联 user_id
        .eq('room_id', roomId)
        .order('seat_number'); // 按座位号排序

      if (playersError) {
        throw new Error(playersError.message || 'Failed to fetch players.');
      }

      const formattedPlayers = playersData.map(p => ({
        ...p,
        id: p.user_id, // 统一用 id 代表 user_id，方便使用
        nickname: (p.profile as any)?.nickname || `玩家${p.nickname || '未知'}`, // 处理 profile 可能为 null 的情况
      })) as Player[];
      setPlayers(formattedPlayers);

      // 3. 找到当前登录用户在此房间的信息
      const currentPlayerInRoom = formattedPlayers.find(p => p.user_id === currentUser.id);
      if (!currentPlayerInRoom && roomData.status !== 'finished') { // 如果游戏没结束但玩家不在列表，可能出错了或被踢了
        //   throw new Error("You are not part of this room, or an error occurred.");
        console.warn("Current user not found in player list, but room is active. Redirecting or showing error.");
        // router.push('/?error=not_in_room'); // 或者显示一个错误信息
        // return;
      }
      setMyPlayerInfo(currentPlayerInRoom || null);


    } catch (err: any) {
      console.error("Error fetching initial room data:", err);
      setError(err.message);
      // 可能需要跳转回主页或显示错误页
      // router.push('/');
    } finally {
      setIsLoading(false);
    }
  }, [supabase, roomId, currentUser, router]);

  useEffect(() => {
    if (currentUser && roomId) {
      fetchInitialData();
    }
  }, [currentUser, roomId, fetchInitialData]);


  // 设置 Supabase Realtime 订阅
  useEffect(() => {
    if (!roomId || !supabase) return;

    // 清理旧的订阅（如果存在）
    if (roomChannel) {
      supabase.removeChannel(roomChannel);
    }

    const channel = supabase
      .channel(`room-${roomId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'game_rooms', filter: `id=eq.${roomId}` }, (payload) => {
        console.log('Game room change received!', payload);
        if (payload.new) {
          setRoomDetails(prev => ({ ...prev, ...(payload.new as GameRoom) }));
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_players', filter: `room_id=eq.${roomId}` }, async (payload) => {
        console.log('Room players change received!', payload);
        // 重新获取所有玩家数据以保持一致性，或者更精细地处理 new/old
        // 简单的做法是重新 fetch players list
        // fetchInitialData(); // 可能会导致不必要的全量刷新，考虑更细致的更新
        // 或者根据 payload 更新:
        if (payload.eventType === 'INSERT') {
            const newPlayerRaw = payload.new as any;
            // 需要 fetch profile for nickname
             const { data: profileData } = await supabase.from('profiles').select('nickname').eq('id', newPlayerRaw.user_id).single();
            const newPlayer: Player = {
                ...newPlayerRaw,
                id: newPlayerRaw.user_id,
                nickname: profileData?.nickname || `玩家${newPlayerRaw.seat_number || '新'}`,
            };
            setPlayers(prev => [...prev, newPlayer].sort((a,b) => (a.seat_number || 99) - (b.seat_number || 99)));
        } else if (payload.eventType === 'UPDATE') {
            const updatedPlayerRaw = payload.new as any;
            setPlayers(prev => prev.map(p => {
                if (p.user_id === updatedPlayerRaw.user_id) {
                    return { ...p, ...updatedPlayerRaw, id: updatedPlayerRaw.user_id, nickname: p.nickname }; // 保留旧昵称，或重新获取
                }
                return p;
            }));
            if (myPlayerInfo && updatedPlayerRaw.user_id === myPlayerInfo.user_id) {
                 setMyPlayerInfo(prev => ({...prev, ...updatedPlayerRaw, id: updatedPlayerRaw.user_id, nickname: prev?.nickname || ''}));
            }
        } else if (payload.eventType === 'DELETE') {
            const deletedPlayerRaw = payload.old as any;
            setPlayers(prev => prev.filter(p => p.user_id !== deletedPlayerRaw.user_id));
        }
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'game_actions', filter: `room_id=eq.${roomId}` }, (payload) => {
        console.log('Game action received!', payload);
        // 更新游戏日志
        // const action = payload.new as any;
        // setGameLog(prev => [...prev, formatGameAction(action)]); // 你需要一个格式化函数
      })
      // 你还可以为特定事件创建广播消息，例如轮到谁行动
      .on('broadcast', { event: 'turn_change' }, (payload) => {
        console.log('Turn change event:', payload);
        // 更新UI提示轮到谁
      })
      .on('broadcast', { event: 'night_action_result', for_user: currentUser?.id }, (payload) => { // 私密消息
        console.log('Private night action result:', payload);
        if (payload.type === 'seer_result') {
            setNightActions(prev => ({...prev, seerCheckedUser: payload.data as NightActions['seerCheckedUser']}));
        }
        // Handle other private results for witch, etc.
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log(`Subscribed to room-${roomId}`);
          // 可以发送一个 "presence" 事件表示用户已加入/在线
          // channel.track({ user_id: currentUser?.id, online_at: new Date().toISOString() });
        } else if (status === 'CHANNEL_ERROR') {
            console.error(`Failed to subscribe to room-${roomId}: CHANNEL_ERROR`);
            setError(`Connection error with the room. Please refresh.`);
        } else if (status === 'TIMED_OUT') {
            console.error(`Failed to subscribe to room-${roomId}: TIMED_OUT`);
            setError(`Connection timed out. Please refresh.`);
        }
      });

    setRoomChannel(channel);

    return () => {
      if (channel) {
        supabase.removeChannel(channel).then(() => console.log(`Unsubscribed from room-${roomId}`));
        setRoomChannel(null);
      }
    };
  }, [roomId, supabase, currentUser]); // currentUser 加入依赖，确保拿到 id 后再发 track


  // --- 处理玩家行为的函数 ---
  const handleSelectSeat = async (seatNumber: number) => {
    if (!myPlayerInfo || !roomDetails || roomDetails.status !== 'lobby') return;
    // 检查座位是否已被占用 (虽然UI应该阻止，但后端也应校验)
    console.log(`Attempting to select seat ${seatNumber}`);
    // API 调用: POST /api/rooms/[roomId]/select-seat { seat_number: seatNumber }
    // 或者直接 Supabase RPC / DB update (需要RLS配合)
    try {
        const { error } = await supabase
            .from('room_players')
            .update({ seat_number: seatNumber })
            .eq('room_id', roomId)
            .eq('user_id', currentUser!.id); // 确保是当前用户
        if (error) throw error;
        // Realtime 会处理UI更新
    } catch (err: any) {
        console.error("Error selecting seat:", err);
        alert(`选座失败: ${err.message}`);
    }
  };

  const handleReady = async () => {
    if (!myPlayerInfo || !roomDetails || roomDetails.status !== 'lobby') return;
    const newReadyState = !myPlayerInfo.is_ready;
    try {
        const { error } = await supabase
            .from('room_players')
            .update({ is_ready: newReadyState })
            .eq('room_id', roomId)
            .eq('user_id', currentUser!.id);
        if (error) throw error;
    } catch (err: any) {
        console.error("Error setting ready state:", err);
        alert(`更新准备状态失败: ${err.message}`);
    }
  };

  const handleStartGame = async () => { // 只有房主能调用
    if (!currentUser || !roomDetails || roomDetails.host_user_id !== currentUser.id || roomDetails.status !== 'lobby') return;
    // 检查是否所有人都准备好，或人数已满
    // API 调用: POST /api/rooms/[roomId]/start
    console.log("房主尝试开始游戏");
     try {
        const response = await fetch(`/api/rooms/${roomId}/start`, { // 你需要创建这个API route
            method: 'POST',
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || "Failed to start game");
        // Realtime 会更新房间状态
    } catch (err: any) {
        console.error("Error starting game:", err);
        alert(`开始游戏失败: ${err.message}`);
    }
  };

  // ... 其他游戏行为的处理器，例如:
  // handleWolfKill(targetUserId)
  // handleSeerCheck(targetUserId)
  // handleWitchSave() / handleWitchPoison(targetUserId)
  // handleSheriffVote(candidateUserId)
  // handleSubmitSpeech()
  // handleVotePlayer(targetUserId)
  // handleHunterShoot(targetUserId)

  // --- 渲染逻辑 ---
  if (isLoading) {
    return <div className="flex items-center justify-center min-h-screen">正在加载房间信息...</div>;
  }

  if (error) {
    return <div className="flex flex-col items-center justify-center min-h-screen text-red-500">
        <p>错误: {error}</p>
        <button onClick={() => router.push('/')} className="mt-4 px-4 py-2 bg-blue-500 text-white rounded">返回首页</button>
      </div>;
  }

  if (!roomDetails || !currentUser) { // 应该在 loading 和 error 之后，或者被他们覆盖
    return <div className="flex items-center justify-center min-h-screen">无法加载房间或用户信息。</div>;
  }


  // 根据 roomDetails.status 渲染不同阶段的UI
  const renderLobby = () => {
    const unseatedPlayers = players.filter(p => p.seat_number === null);
    const seatedPlayers = Array(9).fill(null).map((_, index) => {
        return players.find(p => p.seat_number === index + 1) || null;
    });

    return (
      <div>
        <h2 className="text-2xl font-bold mb-4">房间大厅 (邀请码: {roomDetails.invite_code})</h2>
        <p>模式: {roomDetails.game_settings_choice === 'A' ? "模式A" : "模式B"}</p>
        <p>房主: {players.find(p=>p.user_id === roomDetails.host_user_id)?.nickname || '未知'}</p>

        <h3 className="text-xl mt-6 mb-2">座位区 (点击选座)</h3>
        <div className="grid grid-cols-3 gap-4 mb-6">
            {seatedPlayers.map((player, index) => (
                <button
                    key={index}
                    onClick={() => !player && handleSelectSeat(index + 1)}
                    disabled={!!player && player.user_id !== currentUser.id && myPlayerInfo?.seat_number !== null} // 如果座位有人且不是自己，或者自己已选座，则禁用其他空座
                    className={`p-4 border rounded h-24 flex flex-col items-center justify-center
                        ${player ? 'bg-gray-300' : 'bg-green-100 hover:bg-green-200'}
                        ${myPlayerInfo?.seat_number === (index + 1) ? 'ring-2 ring-blue-500' : ''}
                    `}
                >
                    <span className="font-bold text-lg">{index + 1}号</span>
                    {player ? (
                        <>
                            <span>{player.nickname}</span>
                            {player.is_ready && <span className="text-xs text-green-600">(已准备)</span>}
                        </>
                    ) : (
                        <span className="text-sm text-gray-500">(空位)</span>
                    )}
                </button>
            ))}
        </div>

        {unseatedPlayers.length > 0 && (
            <div className="mb-4">
                <h4 className="text-md font-semibold">等待区:</h4>
                {unseatedPlayers.map(p => <span key={p.id} className="mr-2">{p.nickname}</span>)}
            </div>
        )}


        {myPlayerInfo && myPlayerInfo.seat_number && ( // 只有选了座才能准备
            <button
                onClick={handleReady}
                className={`px-4 py-2 rounded mr-4 ${myPlayerInfo.is_ready ? 'bg-yellow-500 hover:bg-yellow-600' : 'bg-green-500 hover:bg-green-600'} text-white`}
            >
                {myPlayerInfo.is_ready ? '取消准备' : '准备'}
            </button>
        )}

        {roomDetails.host_user_id === currentUser.id && (
          <button
            onClick={handleStartGame}
            disabled={
                players.length < 9 || // 人数不足
                players.some(p => !p.is_ready) || // 有人未准备
                players.some(p => p.seat_number === null) // 有人未选座
            }
            className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded disabled:opacity-50"
          >
            开始游戏 ({players.filter(p=>p.is_ready).length}/{players.length} 人已准备, 共{players.length}人)
          </button>
        )}
         {!myPlayerInfo && players.length < 9 && (
            <p className="text-orange-500 mt-4">您当前不在该房间的玩家列表中，如果刚加入，请等待数据同步或尝试刷新。如果房间未满，您可以尝试选座加入。</p>
        )}
         {!myPlayerInfo && players.length >= 9 && (
             <p className="text-red-500 mt-4">房间已满，您无法加入。</p>
         )}
      </div>
    );
  };

  const renderNightPhase = () => {
    // 根据 myPlayerInfo.role 显示不同的操作界面
    // 例如狼人看到同伴，选择刀人
    // 预言家选择验人
    // 女巫选择用药
    // 计时器
    return (
        <div>
            <h2 className="text-2xl font-bold mb-4">夜晚阶段 - 第 {roomDetails.current_round_number} 夜</h2>
            {myPlayerInfo?.is_alive === false && <p className="text-red-500">你已经死亡，请等待天亮。</p>}
            {myPlayerInfo?.is_alive && (
                <>
                    <p>你的身份: {myPlayerInfo.role || '等待分配...'}</p>
                    {myPlayerInfo.role === 'wolf' && (
                        <div>
                            <p>狼人同伴: {players.filter(p => p.role === 'wolf' && p.user_id !== currentUser.id).map(p => p.nickname).join(', ') || '无'}</p>
                            {/* 狼人选择杀人界面 */}
                        </div>
                    )}
                    {myPlayerInfo.role === 'seer' && nightActions.seerCheckedUser && (
                        <p className="text-blue-500">查验结果: {nightActions.seerCheckedUser.userId} 是 {nightActions.seerCheckedUser.role}</p>
                    )}
                    {/* 其他角色界面 */}
                </>
            )}
        </div>
    );
  };

  const renderDayPhase = () => {
    // 显示死讯，警长竞选，发言，投票等
    return (
        <div>
            <h2 className="text-2xl font-bold mb-4">白天阶段 - 第 {roomDetails.current_round_number} 天</h2>
            {/* ... */}
        </div>
    );
  };

  const renderGameFinished = () => {
    return (
        <div>
            <h2 className="text-2xl font-bold mb-4">游戏结束</h2>
            <p>胜利方: {roomDetails.winning_faction === 'wolves' ? '狼人阵营' : '好人阵营'}</p>
            <h3 className="text-xl mt-4">玩家身份:</h3>
            <ul>
                {players.map(p => (
                    <li key={p.id}>{p.nickname} ({p.seat_number}号): {p.role}</li>
                ))}
            </ul>
            <button onClick={() => router.push('/')} className="mt-6 px-4 py-2 bg-blue-500 text-white rounded">返回大厅</button>
        </div>
    );
  };


  return (
    <div className="container mx-auto p-4">
      {/* 公共信息，例如房间ID，当前状态等 */}
      <div className="mb-6 p-4 bg-gray-100 rounded shadow">
        <p>房间ID: {roomId}</p>
        <p>当前状态: {roomDetails.status}</p>
        {myPlayerInfo && <p>我的信息: {myPlayerInfo.nickname} ({myPlayerInfo.seat_number}号) {myPlayerInfo.is_alive ? '(存活)' : '(死亡)'} {myPlayerInfo.role ? `[${myPlayerInfo.role}]` : ''}</p>}
      </div>

      {/* 根据游戏状态渲染不同内容 */}
      {roomDetails.status === 'lobby' && renderLobby()}
      {roomDetails.status === 'in_game_night' && renderNightPhase()}
      {(roomDetails.status === 'in_game_day_discussion' || roomDetails.status === 'in_game_day_vote' /* ...更多白天状态 */) && renderDayPhase()}
      {roomDetails.status === 'finished' && renderGameFinished()}


      {/* 可以考虑将玩家列表、游戏日志等组件化 */}
      {/* <PlayerList players={players} currentTurnPlayerId={roomDetails.current_turn_player_id} /> */}
      {/* <GameLog entries={gameLog} /> */}

    </div>
  );
}