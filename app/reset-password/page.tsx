"use client"

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/lib/supabase";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage("");
    setError("");
    const { error } = await supabase.auth.updateUser({ password });
    if (error) setError(error.message);
    else {
      setMessage("密码重置成功，请重新登录。");
      setTimeout(() => router.push("/login"), 2000);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-100 px-4">
      <Card className="w-full max-w-sm rounded-lg bg-white shadow-lg">
        <CardHeader>
          <CardTitle className="text-center text-2xl font-bold">重置密码</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="space-y-6" onSubmit={handleSubmit}>
            <div>
              <label htmlFor="password" className="block mb-1 text-sm font-medium">
                新密码
              </label>
              <div className="relative">
                <Input
                  id="password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  required
                  placeholder="请输入新密码"
                  className="text-base pr-12"
                  autoComplete="new-password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 text-xs"
                  onClick={() => setShowPassword(v => !v)}
                  tabIndex={-1}
                >
                  {showPassword ? "隐藏" : "显示"}
                </button>
              </div>
            </div>
            <Button type="submit" className="w-full text-base py-2">
              重置密码
            </Button>
            {message && <p className="text-green-600 text-center text-sm">{message}</p>}
            {error && <p className="text-red-500 text-center text-sm">{error}</p>}
          </form>
          <div className="flex justify-between mt-6 text-sm">
            <Link href="/login" className="text-blue-600 hover:underline">
              返回登录
            </Link>
            <Link href="/register" className="text-blue-600 hover:underline">
              注册账号
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}