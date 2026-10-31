/**
 * 数字人形象。
 *
 * local：观众页渲染内置矢量主播，口型跟着口播时长动。
 * video：把 AVATAR_VIDEO_URL 的循环视频放上台。适合已经导出的数字人成片，
 * 或服务商返回的可播放地址。
 *
 * 实时数字人（硅基智能、腾讯云智能数智人、HeyGen、D-ID 等）通常是：
 * 用商品口播文本向服务商换取一段视频或 WebRTC 地址，再把地址填进 videoUrl。
 * 替换 createAvatar 的返回值即可，观众页不用改。
 */
import type { AvatarProviderId } from '@lingbo/shared';
import type { AppConfig } from '../config';

export interface AvatarPresentation {
  id: AvatarProviderId;
  videoUrl: string | null;
}

export function createAvatar(config: AppConfig): AvatarPresentation {
  if (config.avatarProvider === 'video' && config.avatarVideoUrl) {
    return { id: 'video', videoUrl: config.avatarVideoUrl };
  }
  return { id: 'local', videoUrl: null };
}
