import { notFound } from "next/navigation";
import { PluginPage } from "@/components/PluginPage";
import { PLUGINS, pluginInfo } from "@/lib/plugins";

export function generateStaticParams() {
  return PLUGINS.map((p) => ({ id: p.id }));
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const plugin = pluginInfo((await params).id);
  return { title: plugin ? `${plugin.name} — Плагины — MARYX Ai` : "Плагин — MARYX Ai" };
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const plugin = pluginInfo((await params).id);
  if (!plugin) notFound();
  return <PluginPage id={plugin.id} />;
}
