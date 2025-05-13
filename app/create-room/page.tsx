"use client"; // 标记为客户端组件，因为有交互和状态

import { useState } from 'react';
import { useRouter } from 'next/navigation'; // 使用 next/navigation
import { createBrowserSupabaseClient } from '@/utils/supabase/client'; // 客户端 Supabase
import CreateRoomForm from '@/components/CreateRoomForm'; // 假设你把表单逻辑抽离

export default function CreateRoomPage() {
  const router = useRouter();
  const supabase = createBrowserSupabaseClient(); // 获取客户端 Supabase 实例
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreateRoomSubmit = async (gameSettingsChoice: 'A' | 'B') => {
    setIsLoading(true);
    setError(null);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        // 可以重定向到登录页或显示错误
        router.push('/login?message=Please login to create a room');
        return;
      }

      const response = await fetch('/api/rooms/create', { // API 路由地址
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ gameSettingsChoice }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.message || '创建房间失败');
      }

      const { roomId, inviteCode } = result;
      console.log(`房间创建成功！ID: ${roomId}, 邀请码: ${inviteCode}`);
      router.push(`/rooms/${roomId}`); // 跳转到房间

    } catch (err: unknown) {
      if (err instanceof Error) {
        console.error('创建房间错误:', err);
        setError(err.message || '发生未知错误');
      } else {
        console.error('创建房间错误:', err);
        setError('发生未知错误');
      }
      console.error('创建房间错误:', err);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="container mx-auto p-4 flex flex-col items-center justify-center min-h-screen">
      <h1 className="text-3xl font-bold mb-6">创建狼人杀房间</h1>
      {/* 你可以将表单UI直接写在这里，或者使用 CreateRoomForm 组件 */}
      <CreateRoomForm
        onSubmit={handleCreateRoomSubmit}
        isLoading={isLoading}
        error={error}
      />
      {/*
      // 如果直接写UI:
      // const [gameSettingsChoice, setGameSettingsChoice] = useState<'A' | 'B'>('A');
      // ... 表单元素 ...
      // <button onClick={() => handleCreateRoomSubmit(gameSettingsChoice)} disabled={isLoading}>
      //  {isLoading ? '创建中...' : '确认创建'}
      // </button>
      // {error && <p className="text-red-500">{error}</p>}
      */}
    </div>
  );
}