import { ReviewFrame } from "../types.js";

type FigmaNode = {
  id: string;
  name: string;
  type: string;
  absoluteBoundingBox?: { width: number; height: number };
  children?: FigmaNode[];
};

export function parseFigmaUrl(figmaUrl: string) {
  let url: URL;
  try {
    url = new URL(figmaUrl);
  } catch {
    throw new Error("请输入有效的 Figma URL");
  }
  if (!url.hostname.includes("figma.com")) throw new Error("请输入 Figma 项目链接");

  const match = url.pathname.match(/\/(?:file|design)\/([^/]+)/);
  if (!match?.[1]) throw new Error("无法从链接中解析 Figma file key");

  const rawNodeId = url.searchParams.get("node-id");
  return {
    fileKey: match[1],
    nodeId: rawNodeId ? rawNodeId.replace("-", ":") : null
  };
}

async function figmaFetch(path: string) {
  const token = process.env.FIGMA_TOKEN;
  if (!token) throw new Error("服务端未配置 FIGMA_TOKEN");
  const response = await fetch(`https://api.figma.com/v1${path}`, {
    headers: { "X-Figma-Token": token }
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Figma API 请求失败：${response.status} ${text}`);
  }
  return response.json();
}

export async function readFileStructure(fileKey: string, taskId: string): Promise<{ fileName: string; frames: ReviewFrame[] }> {
  const file = await figmaFetch(`/files/${fileKey}`);
  const pages: FigmaNode[] = file.document?.children ?? [];
  const frames: ReviewFrame[] = [];

  for (const page of pages) {
    const topFrames = (page.children ?? []).filter((node) => ["FRAME", "COMPONENT", "INSTANCE"].includes(node.type));
    for (const node of topFrames) {
      const box = node.absoluteBoundingBox;
      frames.push({
        id: `${taskId}_${node.id.replace(/[:;]/g, "_")}`,
        taskId,
        figmaNodeId: node.id,
        pageName: page.name,
        frameName: node.name,
        width: Math.round(box?.width ?? 0),
        height: Math.round(box?.height ?? 0),
        selected: false,
        sortOrder: frames.length
      });
    }
  }

  const thumbnails = await getFrameImages(fileKey, frames.map((frame) => frame.figmaNodeId), "png", 0.5);
  return {
    fileName: file.name ?? "Untitled Figma File",
    frames: frames.map((frame) => ({ ...frame, thumbnailUrl: thumbnails[frame.figmaNodeId] }))
  };
}

export async function getFrameImages(fileKey: string, nodeIds: string[], format = "png", scale = 2): Promise<Record<string, string>> {
  if (nodeIds.length === 0) return {};
  const ids = encodeURIComponent(nodeIds.join(","));
  const data = await figmaFetch(`/images/${fileKey}?ids=${ids}&format=${format}&scale=${scale}`);
  return data.images ?? {};
}
