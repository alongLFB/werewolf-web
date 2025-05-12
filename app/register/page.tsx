"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function RegisterPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [nickname, setNickname] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { nickname },
      },
    });
    setLoading(false);

    if (error) setError(error.message);
    else router.push("/");
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-100 px-4">
      <Card className="w-full max-w-sm rounded-lg bg-white shadow-lg">
        <CardHeader>
          <CardTitle className="text-center text-2xl font-bold">注册</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="space-y-6" onSubmit={handleRegister}>
            <div>
              <label
                htmlFor="nickname"
                className="block mb-1 text-sm font-medium"
              >
                昵称
              </label>
              <Input
                id="nickname"
                name="nickname"
                type="text"
                required
                placeholder="请输入昵称"
                className="text-base"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                disabled={loading}
              />
            </div>
            <div>
              <label htmlFor="email" className="block mb-1 text-sm font-medium">
                邮箱
              </label>
              <Input
                id="email"
                name="email"
                type="email"
                required
                placeholder="请输入邮箱"
                className="text-base"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={loading}
              />
            </div>
            <div>
              <label
                htmlFor="password"
                className="block mb-1 text-sm font-medium"
              >
                密码
              </label>
              <div className="relative">
                <Input
                  id="password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  required
                  placeholder="请输入密码"
                  className="text-base pr-12"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={loading}
                />
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 text-xs"
                  onClick={() => setShowPassword((v) => !v)}
                  tabIndex={-1}
                  disabled={loading}
                >
                  {showPassword ? "隐藏" : "显示"}
                </button>
              </div>
            </div>
            <Button
              type="submit"
              className="w-full text-base py-2"
              disabled={loading}
            >
              {loading ? "注册中..." : "注册"}
            </Button>
            {error && (
              <p className="text-red-500 text-center text-sm">{error}</p>
            )}
          </form>
          <div className="flex justify-between mt-6 text-sm">
            <Link href="/login" className="text-blue-600 hover:underline">
              已有账号？去登录
            </Link>
          </div>
        </CardContent>
      </Card>
      {/* 可选：全屏遮罩 loading 动画 */}
      {loading && (
        <div className="fixed inset-0 bg-black bg-opacity-20 flex items-center justify-center z-50">
          <div className="bg-white px-6 py-4 rounded shadow text-lg">
            注册中...
          </div>
        </div>
      )}
    </div>
  );
}
