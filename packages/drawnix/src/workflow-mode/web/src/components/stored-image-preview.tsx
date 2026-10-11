import { Image } from 'antd';
import { useStoredMedia } from '@/hooks/use-stored-media';

export type StoredImagePreviewValue = { storageKey?: string; url: string };

export function StoredImagePreview({ image, alt, onClose }: { image: StoredImagePreviewValue; alt: string; onClose: () => void }) {
    const source = useStoredMedia(image.storageKey, image.url, 'image');
    return <Image src={source} alt={alt} style={{ display: 'none' }} preview={{ visible: true, src: source, onVisibleChange: visible => { if (!visible) onClose(); } }} />;
}
