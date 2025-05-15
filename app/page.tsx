'use client';

import { useEffect, useState } from 'react';
import { createBrowserSupabaseClient } from "@/utils/supabase/client";
import type { User } from '@supabase/supabase-js';
import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";

const supabase = createBrowserSupabaseClient();

export default function HomePage() {
  const [user, setUser] = useState<User | null>(null);
  const [profileNickname, setProfileNickname] = useState<string | null>(null);
  // const [profileemail, setProfileemail] = useState<string | null>(null); // If you want to display email
  const [menuOpen, setMenuOpen] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const fetchUserAndProfile = async () => {
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authData.user) {
        setUser(authData.user);
        // Fetch profile from 'profiles' table
        const { data: profileData, error: profileError } = await supabase
          .from('profiles')
          .select('nickname, email') // Select nickname and email
          .eq('id', authData.user.id)
          .single();

        if (profileData) {
          setProfileNickname(profileData.nickname);
          // setProfileemail(profileData.email); // If you want to display email
        } else if (authData.user.user_metadata?.nickname) {
          setProfileNickname(authData.user.user_metadata.nickname);
        } else {
          setProfileNickname('用户'); // Default nickname
        }
        if (profileError) {
          console.warn("Error fetching profile for homepage:", profileError.message);
        }
      } else if (authError) {
        console.error("Error fetching user:", authError.message);
        // router.push("/login"); // Optionally redirect if no user
      }
    };

    fetchUserAndProfile();
  }, [router]);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push("/login");
  };

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col">
      {/* 顶部栏 */}
      <header className="flex items-center justify-between px-4 py-3 bg-white shadow">
        <div className="flex items-center gap-2">
          <Image src="/werewolf-title.png" alt="狼人杀" width={40} height={40} className="rounded" />
          <span className="text-xl font-bold">线下狼人杀</span>
        </div>
        <div className="relative">
          <button
            className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center"
            onClick={() => setMenuOpen((v) => !v)}
          >
            <span className="sr-only">个人中心</span>
            <Image
              src="/avatar-default.png"
              alt="avatar"
              width={32}
              height={32}
              className="rounded-full"
            />
          </button>
          {menuOpen && (
            <div className="absolute right-0 mt-2 w-40 bg-white rounded shadow-lg z-10">
              <Link
                href="/profile"
                className="block px-4 py-2 hover:bg-gray-100 text-sm"
                onClick={() => setMenuOpen(false)}
              >
                个人资料
              </Link>
              <button
                className="block w-full text-left px-4 py-2 hover:bg-gray-100 text-sm"
                onClick={handleSignOut}
              >
                退出登录
              </button>
            </div>
          )}
        </div>
      </header>

      {/* 主体内容 */}
      <main className="flex flex-col items-center justify-center flex-1 px-4">
        <Image
          src="/werewolf-banner.png"
          alt="狼人杀 Banner"
          width={256}
          height={256}
          className="my-8 rounded-lg shadow"
        />
        <h1 className="text-2xl font-bold mb-2">
          欢迎，{profileNickname || (user?.user_metadata?.nickname || '用户')}！
        </h1>
        {/* <p className="mb-8 text-gray-600">邮箱：{profileemail || user?.email}</p> */}
        <br></br>
        {/* 房间操作按钮 */}
        <div className="flex gap-4">
          <Link href="/join-room">
            <Button className="px-8 py-2 text-base">加入房间</Button>
          </Link>
          <Link href="/create-room">
            <Button variant="outline" className="px-8 py-2 text-base">创建房间</Button>
          </Link>
        </div>
      </main>
    </div>
  );
}