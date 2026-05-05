import { ImageResponse } from 'next/og';

export const dynamic = 'force-static';
export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

export default function Icon() {
    return new ImageResponse(
        <div style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#c53030',
            borderRadius: 6,
        }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path d="M6 3v4l-2 2 2 2v4h4l2 2 2-2h4v-4l2-2-2-2V3h-4l-2 2-2-2H6z"
                      fill="white" opacity="0.9" />
                <circle cx="12" cy="12" r="2.5" fill="#c53030" />
            </svg>
        </div>,
        { ...size }
    );
}
