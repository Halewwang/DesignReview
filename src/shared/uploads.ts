export type ImageFileLike = {
  name?: string;
  type: string;
  size: number;
};

export type ImageValidationOptions = {
  currentCount?: number;
  maxCount: number;
  messages?: Partial<Record<"tooMany" | "unsupported" | "tooLarge", string>>;
};

const supportedImageTypes = ["image/png", "image/jpeg", "image/webp"];
const maxImageBytes = 20 * 1024 * 1024;

export function validateImageFiles<T extends ImageFileLike>(files: T[], options: ImageValidationOptions): T[] {
  const currentCount = options.currentCount ?? 0;
  if (currentCount + files.length > options.maxCount) {
    throw new Error(options.messages?.tooMany ?? `单个项目最多上传 ${options.maxCount} 张图片`);
  }

  return files.map((file) => {
    if (!supportedImageTypes.includes(file.type)) {
      throw new Error(options.messages?.unsupported ?? "仅支持 PNG、JPG、WebP 图片");
    }
    if (file.size > maxImageBytes) {
      throw new Error(options.messages?.tooLarge ?? "单张图片不能超过 20MB");
    }
    return file;
  });
}
