export function getProductThumbnailUrl(imageUrl: string, width: number = 400): string {
  const encodedUrl = encodeURIComponent(imageUrl);
  return `/api/v1/images/resize?url=${encodedUrl}&width=${width}&format=webp`;
}

export function getProductFullSizeUrl(imageUrl: string): string {
  return imageUrl;
}
