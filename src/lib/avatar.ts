// Profile pictures: the phone crops and shrinks the photo to a 256 px square
// JPEG (~20 KB) before it's uploaded, then set_avatar() points the profile at it.
import { ApiError, supabase } from './supabase';

const SIZE = 256;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new ApiError('bad_photo'));
    img.src = src;
  });
}

/** Centre-crops to a square and scales to 256×256. Browsers apply the photo's EXIF rotation when drawing. */
export async function squarePhoto(file: File): Promise<Blob> {
  const src = URL.createObjectURL(file);
  try {
    const img = await loadImage(src);
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = SIZE;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, SIZE, SIZE);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new ApiError('bad_photo'))), 'image/jpeg', 0.85));
  } finally {
    URL.revokeObjectURL(src);
  }
}

/** Uploads a new picture, makes it mine, and tidies away the one it replaces. */
export async function uploadAvatar(uid: string, file: File, previous: string | null) {
  const photo = await squarePhoto(file);
  const path = `${uid}/${Date.now().toString(36)}.jpg`;
  const { error } = await supabase.storage.from('avatars').upload(path, photo, { contentType: 'image/jpeg', cacheControl: '31536000' });
  if (error) throw new ApiError('upload_failed');
  const { error: e2 } = await supabase.rpc('set_avatar', { p_avatar: path });
  if (e2) throw new ApiError('upload_failed');
  if (previous && !previous.startsWith('https://')) await supabase.storage.from('avatars').remove([previous]).catch(() => {});
}

/** 'google' = my Google account photo, null = no picture. */
export async function setAvatar(choice: 'google' | null, previous: string | null) {
  const { error } = await supabase.rpc('set_avatar', { p_avatar: choice });
  if (error) throw new ApiError(choice === 'google' ? 'no_google_photo' : 'server_error');
  if (previous && !previous.startsWith('https://')) await supabase.storage.from('avatars').remove([previous]).catch(() => {});
}
