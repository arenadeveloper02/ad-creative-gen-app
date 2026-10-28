export const GOALS = [
  'Awareness',
  'Lead generation',
  'Demo / trial signups',
  'App installs',
  'Event registration',
  'Sales / promotion',
] as const;

export const TONES = ['Professional', 'Bold', 'Friendly', 'Playful', 'Premium', 'Urgent'] as const;

export const VISUAL_STYLES = [
  'Clean / minimal',
  'Product shot',
  'Lifestyle photo',
  'Gradient / abstract',
  'Illustration',
  'Bold typography',
] as const;

export const PLATFORMS: Record<string, readonly string[]> = {
  'Meta (Facebook/Instagram)': ['Feed 1:1', 'Story 9:16', 'Reel 9:16', 'Carousel 3:4'],
  'Google Ads': ['Display 300×250', 'Display 728×90', 'Responsive 1.91:1', 'YouTube thumbnail'],
  LinkedIn: ['Single image 1.91:1', 'Square 1:1', 'Document ad', 'Message ad'],
  'X (Twitter)': ['Image post 16:9', 'Square 1:1'],
  TikTok: ['In-feed 9:16', 'Spark ad 9:16'],
  Pinterest: ['Standard 2:3', 'Idea pin 9:16'],
  Amazon: ['Sponsored brand', 'Display banner'],
};

export const SIZE_FOR: Record<string, string> = {
  'Story 9:16': '1080x1920',
  'Reel 9:16': '1080x1920',
  'In-feed 9:16': '1080x1920',
  'Spark ad 9:16': '1080x1920',
  'Idea pin 9:16': '1080x1920',
  'Display 300×250': '300x250',
  'Single image 1.91:1': '1200x628',
  'Responsive 1.91:1': '1200x628',
  'Image post 16:9': '1200x628',
  'YouTube thumbnail': '1200x628',
  'Standard 2:3': '1080x1350',
  'Carousel 3:4': '1080x1440',
};

export const SIZES = ['1080x1080', '1080x1350', '1080x1440', '1080x1920', '1200x628', '300x250'] as const;

export const LAYOUTS = ['left', 'center', 'bottom'] as const;
export const BACKGROUNDS = ['gradient', 'solid', 'light'] as const;
export const COPY_SOURCES = ['ai', 'manual'] as const;
export const ASSET_KINDS = ['guidelines', 'logos', 'fonts', 'refs'] as const;

export type AssetKind = (typeof ASSET_KINDS)[number];
export type Layout = (typeof LAYOUTS)[number];
export type Background = (typeof BACKGROUNDS)[number];
export type CopySource = (typeof COPY_SOURCES)[number];

const MIME_BY_KIND: Record<AssetKind, readonly string[]> = {
  guidelines: [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain',
  ],
  logos: ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml'],
  fonts: ['font/ttf', 'font/otf', 'font/woff', 'font/woff2', 'application/font-sfnt', 'application/octet-stream'],
  refs: ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf'],
};

export function sizeForFormat(format: string): string {
  return SIZE_FOR[format] ?? '1080x1080';
}

export function mimeAllowed(kind: AssetKind, mime: string): boolean {
  return MIME_BY_KIND[kind].includes(mime);
}
