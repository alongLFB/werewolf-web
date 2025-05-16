import { createServerSupabaseClient } from '@/utils/supabase/server';
import { NextResponse } from 'next/server';

export async function POST(
  request: Request,
  { params }: { params: { roomId: string } }
) {
  const roomId = params.roomId;
  
  // 初始化 Supabase 客户端
  const supabase = await createServerSupabaseClient();
  
  try {
    // 验证用户身份和权限
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json(
        { message: "未授权，请先登录" },
        { status: 401 }
      );
    }
    
    // 获取房间信息
    const { data: roomData, error: roomError } = await supabase
      .from('game_rooms')
      .select('*')
      .eq('id', roomId)
      .single();
      
    if (roomError || !roomData) {
      return NextResponse.json(
        { message: "房间不存在或无法获取房间信息" },
        { status: 404 }
      );
    }
    
    // 验证房间状态
    if (roomData.status !== 'in_game_day_discussion') {
      return NextResponse.json(
        { message: `当前房间状态不是白天讨论阶段 (当前: ${roomData.status})` },
        { status: 400 }
      );
    }
    
    // 验证当前用户是否是房主或警长
    const isHost = roomData.host_user_id === user.id;
    const isSheriff = roomData.police_badge_holder_id === user.id;
    
    if (!isHost && !isSheriff) {
      return NextResponse.json(
        { message: "只有房主或警长可以开始投票阶段" },
        { status: 403 }
      );
    }
    
    // 所有发言者已经发言完毕的验证（可选）
    // 如果你想确保所有发言都已完成，可以添加额外的验证逻辑
    
    // 更新房间状态为投票阶段
    const { error: updateError } = await supabase
      .from('game_rooms')
      .update({ 
        status: 'in_game_day_vote',
        // 可以添加其他需要设置的状态，如投票时间限制等
      })
      .eq('id', roomId);
      
    if (updateError) {
      return NextResponse.json(
        { message: `无法开始投票阶段: ${updateError.message}` },
        { status: 500 }
      );
    }
    
    // 重置所有玩家的投票状态（如有必要）
    const { error: resetVotesError } = await supabase
      .from('room_players')
      .update({
        day_vote_target_id: null,
        // 其他需要重置的投票相关字段
      })
      .eq('room_id', roomId);
    
    if (resetVotesError) {
      console.error('重置投票状态时出错：', resetVotesError);
      // 不中断流程，因为主要状态已更新
    }
    
    return NextResponse.json(
      { 
        message: "成功开始投票阶段",
        status: "in_game_day_vote"
      },
      { status: 200 }
    );
    
  } catch (error) {
    console.error("开始投票阶段出错:", error);
    return NextResponse.json(
      { message: "服务器内部错误" },
      { status: 500 }
    );
  }
}