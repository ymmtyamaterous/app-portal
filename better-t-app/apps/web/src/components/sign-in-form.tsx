import { Button } from "@better-t-app/ui/components/button";
import { Input } from "@better-t-app/ui/components/input";
import { Label } from "@better-t-app/ui/components/label";
import { useForm } from "@tanstack/react-form";
import { useNavigate } from "@tanstack/react-router";
import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import z from "zod";

import { authClient } from "@/lib/auth-client";

import Loader from "./loader";

export default function SignInForm() {
	const [passwordVisible, setPasswordVisible] = useState(false);
	const navigate = useNavigate({
		from: "/",
	});
	const { isPending } = authClient.useSession();

	const form = useForm({
		defaultValues: {
			email: "",
			password: "",
		},
		onSubmit: async ({ value }) => {
			await authClient.signIn.email(
				{
					email: value.email,
					password: value.password,
				},
				{
					onSuccess: () => {
						navigate({
							to: "/admin",
							search: { tab: "manage", period: "all" },
						});
						toast.success("ログインしました。");
					},
					onError: (error) => {
						toast.error("メールアドレスまたはパスワードが正しくありません。");
					},
				},
			);
		},
		validators: {
			onSubmit: z.object({
				email: z.email("Invalid email address"),
				password: z.string().min(12, "Password must be at least 12 characters"),
			}),
		},
	});

	if (isPending) {
		return <Loader />;
	}

	return (
		<div className="mx-auto w-full mt-10 max-w-md p-6">
			<h1 className="mb-6 text-center text-3xl font-bold">Welcome Back</h1>

			<form
				onSubmit={(e) => {
					e.preventDefault();
					e.stopPropagation();
					form.handleSubmit();
				}}
				className="space-y-4"
			>
				<div>
					<form.Field name="email">
						{(field) => (
							<div className="space-y-2">
								<Label htmlFor={field.name}>Email</Label>
								<Input
									id={field.name}
									name={field.name}
									type="email"
									value={field.state.value}
									onBlur={field.handleBlur}
									onChange={(e) => field.handleChange(e.target.value)}
								/>
								{field.state.meta.errors.map((error) => (
									<p key={error?.message} className="text-red-500">
										{error?.message}
									</p>
								))}
							</div>
						)}
					</form.Field>
				</div>

				<div>
					<form.Field name="password">
						{(field) => (
							<div className="space-y-2">
								<Label htmlFor={field.name}>Password</Label>
								<div className="relative">
									<Input
										id={field.name}
										name={field.name}
										type={passwordVisible ? "text" : "password"}
										value={field.state.value}
										onBlur={field.handleBlur}
										onChange={(e) => field.handleChange(e.target.value)}
									/>
									<Button
										type="button"
										size="icon"
										variant="ghost"
										className="absolute right-0 top-0"
										onClick={() => setPasswordVisible((visible) => !visible)}
										aria-label={
											passwordVisible ? "パスワードを隠す" : "パスワードを表示"
										}
									>
										{passwordVisible ? <EyeOff /> : <Eye />}
									</Button>
								</div>
								{field.state.meta.errors.map((error) => (
									<p key={error?.message} className="text-red-500">
										{error?.message}
									</p>
								))}
							</div>
						)}
					</form.Field>
				</div>

				<form.Subscribe
					selector={(state) => ({
						canSubmit: state.canSubmit,
						isSubmitting: state.isSubmitting,
					})}
				>
					{({ canSubmit, isSubmitting }) => (
						<Button
							type="submit"
							className="w-full"
							disabled={!canSubmit || isSubmitting}
						>
							{isSubmitting ? "Submitting..." : "Sign In"}
						</Button>
					)}
				</form.Subscribe>
			</form>
		</div>
	);
}
