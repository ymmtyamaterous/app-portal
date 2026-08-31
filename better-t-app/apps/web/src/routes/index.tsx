import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ExternalLink, Grid2X2, List, Search } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@better-t-app/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@better-t-app/ui/components/card";
import { Input } from "@better-t-app/ui/components/input";
import { client, orpc } from "@/utils/orpc";

export const Route = createFileRoute("/")({
	component: HomeComponent,
});

function HomeComponent() {
	const [query, setQuery] = useState("");
	const [selectedTag, setSelectedTag] = useState<string | null>(null);
	const [view, setView] = useState<"grid" | "category">("grid");
	const linksQuery = useQuery(
		orpc.links.publicList.queryOptions({ input: { page: 1, pageSize: 100 } }),
	);
	const links = linksQuery.data?.items ?? [];
	const tags = useMemo(
		() =>
			Array.from(
				new Set(links.flatMap((link) => link.tags.map((tag) => tag.name))),
			).sort((a, b) => a.localeCompare(b, "ja")),
		[links],
	);
	const filteredLinks = useMemo(() => {
		const normalizedQuery = query.trim().toLocaleLowerCase();
		return links.filter((link) => {
			const matchesQuery =
				!normalizedQuery ||
				[
					link.title,
					link.description ?? "",
					link.url,
					...link.tags.map((tag) => tag.name),
				].some((value) => value.toLocaleLowerCase().includes(normalizedQuery));
			return (
				matchesQuery &&
				(!selectedTag || link.tags.some((tag) => tag.name === selectedTag))
			);
		});
	}, [links, query, selectedTag]);

	const openLink = (id: string, url: string) => {
		void client.analytics.recordAccess({ linkId: id }).catch(() => undefined);
		window.open(url, "_blank", "noopener,noreferrer");
	};

	return (
		<main className="container mx-auto max-w-7xl px-4 py-8">
			<section className="mb-8 space-y-5">
				<div>
					<p className="text-sm font-medium text-primary">APP PORTAL</p>
					<h1 className="text-3xl font-bold tracking-tight">公開リンク</h1>
					<p className="mt-2 text-muted-foreground">
						必要なアプリケーションとサービスを見つけられます。
					</p>
				</div>
				<div className="flex flex-col gap-3 sm:flex-row sm:items-center">
					<div className="relative flex-1">
						<Search className="absolute left-3 top-3 size-4 text-muted-foreground" />
						<Input
							className="pl-9"
							value={query}
							onChange={(event) => setQuery(event.target.value)}
							placeholder="タイトル、説明、タグで検索"
						/>
					</div>
					<div className="flex gap-1">
						<Button
							variant={view === "grid" ? "default" : "outline"}
							size="icon"
							onClick={() => setView("grid")}
							aria-label="グリッド表示"
						>
							<Grid2X2 />
						</Button>
						<Button
							variant={view === "category" ? "default" : "outline"}
							size="icon"
							onClick={() => setView("category")}
							aria-label="カテゴリ表示"
						>
							<List />
						</Button>
					</div>
				</div>
				<div className="flex flex-wrap gap-2">
					<Button
						size="sm"
						variant={!selectedTag ? "default" : "outline"}
						onClick={() => setSelectedTag(null)}
					>
						すべて
					</Button>
					{tags.map((tag) => (
						<Button
							key={tag}
							size="sm"
							variant={selectedTag === tag ? "default" : "outline"}
							onClick={() => setSelectedTag(tag)}
						>
							{tag}
						</Button>
					))}
				</div>
			</section>
			{linksQuery.isLoading ? (
				<p className="py-12 text-center text-muted-foreground">
					リンクを読み込んでいます…
				</p>
			) : null}
			{linksQuery.isError ? (
				<p className="py-12 text-center text-destructive">
					リンクの取得に失敗しました。時間をおいて再度お試しください。
				</p>
			) : null}
			{!linksQuery.isLoading &&
			!linksQuery.isError &&
			filteredLinks.length === 0 ? (
				<p className="py-12 text-center text-muted-foreground">
					条件に一致する公開リンクはありません。
				</p>
			) : null}
			<div
				className={
					view === "grid"
						? "grid gap-5 sm:grid-cols-2 lg:grid-cols-3"
						: "space-y-4"
				}
			>
				{filteredLinks.map((link) => (
					<Card
						key={link.id}
						className={view === "category" ? "sm:flex-row" : ""}
					>
						{link.imageUploadId ? (
							<img
								className={
									view === "category"
										? "h-32 w-full object-cover sm:w-48"
										: "h-44 w-full object-cover"
								}
								src={`/media/images/${link.imageUploadId}`}
								alt=""
							/>
						) : null}
						<div className="flex flex-1 flex-col">
							<CardHeader>
								<CardTitle>{link.title}</CardTitle>
								<CardDescription className="line-clamp-3">
									{link.description || "説明はありません。"}
								</CardDescription>
							</CardHeader>
							<CardContent className="mt-auto space-y-4">
								<div className="flex flex-wrap gap-1">
									{link.tags.map((tag) => (
										<span key={tag.id} className="bg-muted px-2 py-0.5 text-xs">
											{tag.name}
										</span>
									))}
								</div>
								<Button
									className="w-full"
									onClick={() => openLink(link.id, link.url)}
								>
									開く <ExternalLink />
								</Button>
							</CardContent>
						</div>
					</Card>
				))}
			</div>
		</main>
	);
}
