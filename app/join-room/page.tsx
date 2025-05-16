'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserSupabaseClient } from '@/utils/supabase/client'; // 客户端 Supabase
import JoinRoomForm from '@/components/JoinRoomForm'; // 假设你把表单逻辑抽离

export default function JoinRoomPage() {
  const router = useRouter();
  const supabase = createBrowserSupabaseClient();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleJoinRoomSubmit = async (inviteCode: string) => {
    setIsLoading(true);
    setError(null);

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.push('/login?message=Please login to join a room');
        return;
      }

      const response = await fetch('/api/rooms/join', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ inviteCode: inviteCode.toUpperCase() }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.message || '加入房间失败');
      }

      const { roomId } = result;
      console.log(`成功加入房间！ID: ${roomId}`);
      router.push(`/rooms/${roomId}`);
    } catch (err: unknown) {
      //   console.error("加入房间错误:", err);
      //   setError(err.message || "发生未知错误");

      if (err instanceof Error) {
        console.error('加入房间错误:', err);
        setError(err.message || '发生未知错误');
      } else {
        console.error('加入房间错误:', err);
        setError('发生未知错误');
      }
      console.error('加入房间错误:', err);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="container mx-auto p-4 flex flex-col items-center justify-center min-h-screen">
      <h1 className="text-3xl font-bold mb-6">加入狼人杀房间</h1>
      <JoinRoomForm
        onSubmit={handleJoinRoomSubmit}
        isLoading={isLoading}
        error={error}
      />
    </div>
  );
}
