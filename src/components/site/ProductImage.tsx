import { useState, type ImgHTMLAttributes } from "react";
import { productPlaceholderImage } from "@/data/catalog";

export const productPlaceholder = productPlaceholderImage;

/** Broken or absent SKU photos use a neutral image, never another product. */
export function ProductImage({ src, alt, ...props }: ImgHTMLAttributes<HTMLImageElement>) {
  const [failedSource, setFailedSource] = useState<string>();
  return <img {...props} src={!src || src === failedSource ? productPlaceholder : src} alt={alt ?? ""} onError={() => setFailedSource(src)} />;
}
