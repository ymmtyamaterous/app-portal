import { Button } from "@better-t-app/ui/components/button";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@better-t-app/ui/components/card";
import { Input } from "@better-t-app/ui/components/input";
import { Label } from "@better-t-app/ui/components/label";
import { Textarea } from "@better-t-app/ui/components/textarea";
import { env } from "@better-t-app/env/web";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { Download, Pencil, Trash2 } from "lucide-react";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { client, getServerUrl, orpc } from "@/utils/orpc";

const searchSchema = z.object({
	tab: z.enum(["manage", "analytics"]).catch("manage"),
	period: z.enum(["all", "7d", "30d"]).catch("all"),
});
type LinkForm = {
	id?: string;
	title: string;
	url: string;
	description: string;
	tags: string;
	visible: boolean;
	imageUploadId: string | null;
};
type AdminLink = {
	id: string;
	title: string;
	url: string;
	description: string | null;
	visible: boolean;
	imageUploadId: string | null;
	updatedAt: Date;
	tags: { id: string; name: string; normalizedName: string }[];
};
const emptyForm: LinkForm = {
	title: "",
	url: "",
	description: "",
	tags: "",
	visible: true,
	imageUploadId: null,
};

export const Route = createFileRoute("/_auth/admin")({
	validateSearch: searchSchema,
	beforeLoad: ({ context }) => {
		const role = (context.session.data?.user as { role?: string } | undefined)
			?.role;
		if (role !== "admin") throw redirect({ to: "/", replace: true });
	},
	component: AdminPage,
});

function AdminPage() {
	const search = Route.useSearch();
	const navigate = Route.useNavigate();
	const queryClient = useQueryClient();
	const [form, setForm] = useState<LinkForm>(emptyForm);
	const [uploading, setUploading] = useState<"image" | "apk" | null>(null);
	const linksQuery = useQuery(
		orpc.links.adminList.queryOptions({ input: { page: 1, pageSize: 100 } }),
	);
	const imagesQuery = useQuery(
		orpc.uploads.list.queryOptions({
			input: { kind: "image", page: 1, pageSize: 100 },
		}),
	);
	const summaryQuery = useQuery({
		...orpc.analytics.summary.queryOptions(),
		enabled: search.tab === "analytics",
	});
	const popularQuery = useQuery({
		...orpc.analytics.popular.queryOptions({
			input: { period: search.period },
		}),
		enabled: search.tab === "analytics",
	});
	const invalidateLinks = () =>
		queryClient.invalidateQueries({ queryKey: orpc.links.key() });
	const saveMutation = useMutation({
		mutationFn: async (value: LinkForm) => {
			const data = {
				title: value.title,
				url: value.url,
				description: value.description || null,
				visible: value.visible,
				imageUploadId: value.imageUploadId,
				tags: value.tags
					.split(",")
					.map((tag) => tag.trim())
					.filter(Boolean),
			};
			return value.id
				? client.links.update({ id: value.id, ...data })
				: client.links.create(data);
		},
		onSuccess: () => {
			void invalidateLinks();
			setForm(emptyForm);
			toast.success("リンクを保存しました。");
		},
		onError: () =>
			toast.error("リンクを保存できませんでした。入力内容を確認してください。"),
	});
	const removeMutation = useMutation({
		mutationFn: (id: string) => client.links.remove({ id }),
		onSuccess: () => {
			void invalidateLinks();
			toast.success("リンクを削除しました。");
		},
		onError: () => toast.error("リンクを削除できませんでした。"),
	});
	const updateMutation = useMutation({
		mutationFn: (value: AdminLink) =>
			client.links.update({
				id: value.id,
				title: value.title,
				url: value.url,
				description: value.description,
				visible: !value.visible,
				imageUploadId: value.imageUploadId,
				tags: value.tags.map((tag) => tag.name),
			}),
		onSuccess: invalidateLinks,
		onError: () => toast.error("公開状態を変更できませんでした。"),
	});
	const exportMutation = useMutation({
		mutationFn: () => client.analytics.exportLinksJson(),
		onSuccess: ({ filename, links }) => {
			const anchor = document.createElement("a");
			anchor.href = URL.createObjectURL(
				new Blob([JSON.stringify({ links }, null, 2)], {
					type: "application/json",
				}),
			);
			anchor.download = filename;
			anchor.click();
			URL.revokeObjectURL(anchor.href);
		},
	});

	const upload = async (kind: "image" | "apk", file: File) => {
		setUploading(kind);
		try {
			const data = new FormData();
			data.set("file", file);
			const result = await fetch(
				`${getServerUrl(env.VITE_SERVER_URL)}/api/uploads/${kind === "image" ? "images" : "apks"}`,
				{ method: "POST", credentials: "include", body: data },
			);
			if (!result.ok) throw new Error();
			const saved = (await result.json()) as { id: string };
			if (kind === "image") {
				setForm((current) => ({ ...current, imageUploadId: saved.id }));
				void imagesQuery.refetch();
			}
			toast.success(
				kind === "image"
					? "画像をアップロードしました。"
					: "APK をアップロードしました。",
			);
		} catch {
			toast.error("ファイルをアップロードできませんでした。");
		} finally {
			setUploading(null);
		}
	};
	const edit = (link: AdminLink) =>
		setForm({
			id: link.id,
			title: link.title,
			url: link.url,
			description: link.description ?? "",
			tags: link.tags.map((tag) => tag.name).join(", "),
			visible: link.visible,
			imageUploadId: link.imageUploadId,
		});
	const setTab = (tab: "manage" | "analytics") =>
		navigate({ search: { ...search, tab } });
	const formatDate = (value: Date | string | null) =>
		value
			? new Intl.DateTimeFormat("ja-JP", {
					dateStyle: "medium",
					timeStyle: "short",
				}).format(new Date(value))
			: "—";

	return (
		<main className="container mx-auto max-w-7xl px-4 py-8">
			<div className="mb-6 flex flex-wrap items-center justify-between gap-3">
				<div>
					<p className="text-sm font-medium text-primary">ADMIN</p>
					<h1 className="text-3xl font-bold">管理画面</h1>
				</div>
				<Button
					variant="outline"
					onClick={() => exportMutation.mutate()}
					disabled={exportMutation.isPending}
				>
					<Download /> JSON エクスポート
				</Button>
			</div>
			<div className="mb-6 flex gap-2 border-b">
				<Button
					variant={search.tab === "manage" ? "default" : "ghost"}
					onClick={() => setTab("manage")}
				>
					管理
				</Button>
				<Button
					variant={search.tab === "analytics" ? "default" : "ghost"}
					onClick={() => setTab("analytics")}
				>
					分析
				</Button>
			</div>
			{search.tab === "manage" ? (
				<section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
					<div className="space-y-3">
						<h2 className="text-xl font-semibold">リンク一覧</h2>
						{linksQuery.isLoading ? (
							<p>読み込んでいます…</p>
						) : (
							linksQuery.data?.items.map((link) => (
								<Card key={link.id}>
									<CardContent className="flex flex-wrap items-center justify-between gap-3">
										<div>
											<p className="font-medium">{link.title}</p>
											<p className="text-xs text-muted-foreground">
												{link.url}
											</p>
											<p className="mt-1 text-xs">
												{formatDate(link.updatedAt)} ·{" "}
												{link.visible ? "公開中" : "非公開"}
											</p>
										</div>
										<div className="flex gap-2">
											<Button
												size="sm"
												variant="outline"
												onClick={() =>
													updateMutation.mutate({
														...link,
													})
												}
											>
												{link.visible ? "非公開にする" : "公開する"}
											</Button>
											<Button
												size="icon"
												variant="outline"
												onClick={() => edit(link)}
												aria-label={`${link.title}を編集`}
											>
												<Pencil />
											</Button>
											<Button
												size="icon"
												variant="destructive"
												onClick={() => {
													if (
														window.confirm(`「${link.title}」を削除しますか？`)
													)
														removeMutation.mutate(link.id);
												}}
												aria-label={`${link.title}を削除`}
											>
												<Trash2 />
											</Button>
										</div>
									</CardContent>
								</Card>
							))
						)}
					</div>
					<Card>
						<CardHeader>
							<CardTitle>{form.id ? "リンクを編集" : "新しいリンク"}</CardTitle>
						</CardHeader>
						<CardContent>
							<form
								className="space-y-4"
								onSubmit={(event) => {
									event.preventDefault();
									saveMutation.mutate(form);
								}}
							>
								<Field label="タイトル">
									<Input
										value={form.title}
										onChange={(event) =>
											setForm({ ...form, title: event.target.value })
										}
										required
										maxLength={120}
									/>
								</Field>
								<Field label="URL">
									<Input
										type="url"
										value={form.url}
										onChange={(event) =>
											setForm({ ...form, url: event.target.value })
										}
										required
									/>
								</Field>
								<Field label="説明">
									<Textarea
										value={form.description}
										onChange={(event) =>
											setForm({ ...form, description: event.target.value })
										}
									/>
								</Field>
								<Field label="タグ（カンマ区切り）">
									<Input
										value={form.tags}
										onChange={(event) =>
											setForm({ ...form, tags: event.target.value })
										}
									/>
								</Field>
								<label className="flex items-center gap-2 text-sm">
									<input
										type="checkbox"
										checked={form.visible}
										onChange={(event) =>
											setForm({ ...form, visible: event.target.checked })
										}
									/>{" "}
									公開する
								</label>
								<Field label="画像">
									<div className="flex gap-2">
										<select
											className="h-9 flex-1 border bg-transparent px-2 text-sm"
											value={form.imageUploadId ?? ""}
											onChange={(event) =>
												setForm({
													...form,
													imageUploadId: event.target.value || null,
												})
											}
										>
											<option value="">画像なし</option>
											{imagesQuery.data?.items.map((image) => (
												<option key={image.id} value={image.id}>
													{image.originalName ?? image.id}
												</option>
											))}
										</select>
										<Button
											type="button"
											size="icon"
											variant="outline"
											onClick={() => setForm({ ...form, imageUploadId: null })}
											aria-label="画像を解除"
										>
											<Trash2 />
										</Button>
									</div>
								</Field>
								<label className="block">
									<span className="sr-only">画像を置換</span>
									<Input
										type="file"
										accept="image/jpeg,image/png,image/gif,image/webp"
										disabled={uploading !== null}
										onChange={(event) => {
											const file = event.target.files?.[0];
											if (file) void upload("image", file);
										}}
									/>
								</label>
								<label className="block">
									<span className="mb-1 block text-sm">APK をアップロード</span>
									<Input
										type="file"
										accept=".apk,application/vnd.android.package-archive"
										disabled={uploading !== null}
										onChange={(event) => {
											const file = event.target.files?.[0];
											if (file) void upload("apk", file);
										}}
									/>
								</label>
								<div className="flex gap-2">
									<Button type="submit" disabled={saveMutation.isPending}>
										{form.id ? "更新する" : "作成する"}
									</Button>
									{form.id ? (
										<Button
											type="button"
											variant="outline"
											onClick={() => setForm(emptyForm)}
										>
											キャンセル
										</Button>
									) : null}
								</div>
							</form>
						</CardContent>
					</Card>
				</section>
			) : (
				<Analytics
					summary={summaryQuery.data}
					popular={popularQuery.data}
					period={search.period}
					setPeriod={(period) => navigate({ search: { ...search, period } })}
					formatDate={formatDate}
				/>
			)}
		</main>
	);
}

function Field({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div className="space-y-1">
			<Label>{label}</Label>
			{children}
		</div>
	);
}
function Analytics({
	summary,
	popular,
	period,
	setPeriod,
	formatDate,
}: {
	summary:
		| {
				totalLinks: number;
				totalClicks: number;
				uniqueLinks: number;
				todayClicks: number;
				sevenDayClicks: number;
				thirtyDayClicks: number;
		  }
		| undefined;
	popular:
		| {
				id: string;
				title: string;
				url: string;
				clicks: number;
				lastAccessedAt: Date | null;
		  }[]
		| undefined;
	period: "all" | "7d" | "30d";
	setPeriod: (period: "all" | "7d" | "30d") => void;
	formatDate: (value: Date | string | null) => string;
}) {
	const metrics = [
		["総リンク数", summary?.totalLinks],
		["総クリック数", summary?.totalClicks],
		["ユニークリンク数", summary?.uniqueLinks],
		["本日", summary?.todayClicks],
		["7日間", summary?.sevenDayClicks],
		["30日間", summary?.thirtyDayClicks],
	];
	return (
		<section className="space-y-6">
			<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
				{metrics.map(([label, value]) => (
					<Card key={String(label)}>
						<CardHeader>
							<p className="text-muted-foreground">{label}</p>
							<CardTitle className="text-3xl">{value ?? "—"}</CardTitle>
						</CardHeader>
					</Card>
				))}
			</div>
			<Card>
				<CardHeader>
					<CardTitle>人気リンク</CardTitle>
					<div className="flex gap-2">
						{(["all", "7d", "30d"] as const).map((value) => (
							<Button
								key={value}
								size="sm"
								variant={period === value ? "default" : "outline"}
								onClick={() => setPeriod(value)}
							>
								{value === "all" ? "全期間" : value}
							</Button>
						))}
					</div>
				</CardHeader>
				<CardContent>
					<div className="overflow-x-auto">
						<table className="w-full text-sm">
							<thead>
								<tr className="border-b text-left">
									<th className="p-2">リンク</th>
									<th className="p-2">クリック</th>
									<th className="p-2">最終アクセス</th>
								</tr>
							</thead>
							<tbody>
								{popular?.map((link) => (
									<tr className="border-b" key={link.id}>
										<td className="p-2">
											<p>{link.title}</p>
											<p className="text-xs text-muted-foreground">
												{link.url}
											</p>
										</td>
										<td className="p-2">{link.clicks}</td>
										<td className="p-2">{formatDate(link.lastAccessedAt)}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</CardContent>
			</Card>
		</section>
	);
}
