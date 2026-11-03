// 照片在手機上壓縮後才存，縮圖給清單用，大圖給「給店員看」用。
const FULL_SIDE = 1280;
const FULL_QUALITY = 0.72;
const THUMB_SIDE = 240;
const THUMB_QUALITY = 0.6;

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('這張照片無法開啟，請換一張再試一次。'));
    };
    image.src = url;
  });
}

function resize(image, maxSide, quality) {
  const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('照片壓縮失敗，請再試一次。'))),
      'image/jpeg',
      quality,
    );
  });
}

export async function compressPhoto(file) {
  const image = await loadImage(file);
  const [full, thumb] = await Promise.all([
    resize(image, FULL_SIDE, FULL_QUALITY),
    resize(image, THUMB_SIDE, THUMB_QUALITY),
  ]);
  return { full, thumb };
}
