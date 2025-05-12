"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/lib/supabase";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage("");
    setError("");
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) setError(error.message);
    else setMessage("重置邮件已发送，请检查邮箱。");
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-100 px-4">
      <Card className="w-full max-w-sm rounded-lg bg-white shadow-lg">
        <CardHeader>
          <CardTitle className="text-center text-2xl font-bold">
            忘记密码
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form className="space-y-6" onSubmit={handleSubmit}>
            <div>
              <label htmlFor="email" className="block mb-1 text-sm font-medium">
                邮箱
              </label>
              <Input
                id="email"
                name="email"
                type="email"
                required
                placeholder="请输入注册邮箱"
                className="text-base"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <Button type="submit" className="w-full text-base py-2">
              发送重置邮件
            </Button>
            {message && (
              <p className="text-green-600 text-center text-sm">{message}</p>
            )}
            {error && (
              <p className="text-red-500 text-center text-sm">{error}</p>
            )}
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
