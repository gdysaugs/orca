import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
} from 'react'
import type { Session } from '@supabase/supabase-js'
import { isAuthConfigured, supabase } from '../lib/supabaseClient'
import { saveGeneratedAsset } from '../lib/downloadMedia'
import { fetchWithAuth } from '../lib/authFetch'
import { GET_CREDIT_PURCHASE_URL } from '../lib/externalLinks'
import { TopNav } from '../components/TopNav'
import './camera.css'
import './video-studio.css'

type VideoModel = 'orca'
type VideoModelConfig = {
  id: VideoModel
  label: 'Orca'
  endpoint: string
}

type VideoLengthSeconds = (typeof VIDEO_LENGTH_OPTIONS)[number]['seconds']

type SubmitVideoResult =
  | { videos: string[]; jobId?: never }
  | { videos?: never; jobId: string }

type PollVideoResult = {
  status: 'done' | 'cancelled'
  videos: string[]
}

type DailyBonusResponse = {
  can_claim?: boolean
  granted?: boolean
  tickets_left?: number | null
  remaining_seconds?: number
  next_eligible_at?: string | null
  amount?: number
  cooldown_hours?: number
  error?: string
}

type CapturableVideoElement = HTMLVideoElement & {
  captureStream?: (frameRate?: number) => MediaStream
  webkitCaptureStream?: (frameRate?: number) => MediaStream
}

type CapturableCanvasElement = HTMLCanvasElement & {
  captureStream?: (frameRate?: number) => MediaStream
}

const captureVideoElementStream = (el: CapturableVideoElement, frameRate?: number) => {
  if (typeof el.captureStream === 'function') return el.captureStream(frameRate)
  if (typeof el.webkitCaptureStream === 'function') return el.webkitCaptureStream(frameRate)
  return null
}

const VIDEO_MODELS: Record<VideoModel, VideoModelConfig> = {
  orca: {
    id: 'orca',
    label: 'Orca',
    endpoint: '/api/wan-lora-pack',
  },
}
const DEFAULT_VIDEO_MODEL: VideoModel = 'orca'

const FIXED_STEPS = 4
const FIXED_CFG = 1
const FIXED_FPS = 10
const MIX_EXPORT_MIME_CANDIDATES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
] as const
const VIDEO_LENGTH_OPTIONS = [
  { seconds: 5, frames: 53, ticketCost: 1, label: '5秒 / 1クレジット' },
  { seconds: 7, frames: 73, ticketCost: 2, label: '7秒 / 2クレジット' },
  { seconds: 10, frames: 101, ticketCost: 3, label: '10秒 / 3クレジット' },
] as const
const DEFAULT_VIDEO_LENGTH_SECONDS = VIDEO_LENGTH_OPTIONS[0].seconds
const DEFAULT_LORA_STRENGTH = 0
const MIN_LORA_STRENGTH = 0
const ACTIVE_LORA_STRENGTH = 0.1
const MAX_LORA_STRENGTH = 1.5
const LORA_OPTIONS = [
  { id: 'low_e9ab98e68aace885', label: '片足上げ' },
  { id: 'e68a93e4bd8fe8b7aa', label: '首掴み跪き' },
  { id: 'e78ebbe79283', label: '硝子接吻' },
  { id: 'facedownassup', label: '俯せ後背位' },
  { id: 'e6b7b9e6b2a1', label: '画面水飛沫' },
  { id: 'e68993e884b890e9ab98', label: '顔面衝撃' },
  { id: 'frenchkiss', label: '濃厚接吻' },
  { id: 'reverse_suspended_congress', label: '抱上げ後背位' },
  { id: 'handjob_blowjob_combo', label: '手口連携' },
  { id: 'pov_titfuck_paizuri', label: '一人称乳交' },
  { id: 'cumshot_aesthetics_1', label: '射精演出 1' },
  { id: 'cumshot_aesthetics_2', label: '射精演出 2' },
  { id: 'cumshot_aesthetics_3', label: '射精演出 3' },
  { id: 'cumshot_aesthetics_4', label: '射精演出 4' },
  { id: 'pov_missionary', label: '一人称正常位' },
  { id: 'i2pee', label: '小便' },
  { id: 'blink_titjob_1', label: '瞬間切替乳交 1' },
  { id: 'blink_titjob_2', label: '瞬間切替乳交 2' },
  { id: 'blink_back_doggystyle_1', label: '瞬間切替背面後背位 1' },
  { id: 'blink_back_doggystyle_2', label: '瞬間切替背面後背位 2' },
  { id: 'blink_facial_1', label: '瞬間切替顔射 1' },
  { id: 'blink_facial_2', label: '瞬間切替顔射 2' },
  { id: 'blink_front_doggystyle_1', label: '瞬間切替正面後背位 1' },
  { id: 'blink_front_doggystyle_2', label: '瞬間切替正面後背位 2' },
  { id: 'blink_front_doggystyle_3', label: '瞬間切替正面後背位 3' },
  { id: 'blink_handjob_1', label: '瞬間切替手交 1' },
  { id: 'blink_handjob_2', label: '瞬間切替手交 2' },
  { id: 'blink_handjob_3', label: '瞬間切替手交 3' },
  { id: 'blink_blowjob', label: '瞬間切替口交' },
  { id: 'blink_missionary_1', label: '瞬間切替正常位 1' },
  { id: 'blink_missionary_2', label: '瞬間切替正常位 2' },
  { id: 'blink_missionary_3', label: '瞬間切替正常位 3' },
  { id: 'blink_squatting_cowgirl_1', label: '瞬間切替屈み女上位 1' },
  { id: 'blink_squatting_cowgirl_2', label: '瞬間切替屈み女上位 2' },
  { id: 'sideleg_transition', label: '側位姿勢' },
] as const
type LoraOptionId = (typeof LORA_OPTIONS)[number]['id']
const FREE_LORA_OPTION_IDS = new Set<LoraOptionId>([
  'low_e9ab98e68aace885',
  'e68a93e4bd8fe8b7aa',
  'e78ebbe79283',
  'e6b7b9e6b2a1',
  'e68993e884b890e9ab98',
  'frenchkiss',
  'cumshot_aesthetics_1',
  'blink_titjob_1',
  'blink_back_doggystyle_1',
  'blink_facial_1',
  'blink_handjob_1',
  'blink_blowjob',
  'blink_missionary_1',
])
const isPremiumLoraOption = (id: LoraOptionId) => !FREE_LORA_OPTION_IDS.has(id)
const SCREEN_FLOOD_LORA_ID: LoraOptionId = 'e6b7b9e6b2a1'
const SCREEN_FLOOD_TRIGGER = 'yanmo567'
const SCREEN_FLOOD_PROMPT = 'a huge splash of water erupts from the bottom and submerges the entire screen.'
const LIFT_ONE_LEG_LORA_ID: LoraOptionId = 'low_e9ab98e68aace885'
const LIFT_ONE_LEG_PROMPT = 'They lifted one of their legs high up.'
const FACE_DOWN_ASS_UP_LORA_ID: LoraOptionId = 'facedownassup'
const FACE_DOWN_ASS_UP_PROMPT =
  'A naked woman is having sex with a man in the face-down ass-up position. She is having sex with a man in the top-down bottom-up position'
const SUSPENDED_CONGRESS_LORA_ID: LoraOptionId = 'reverse_suspended_congress'
const SUSPENDED_CONGRESS_PROMPT =
  'A woman is having sex in the reverse_suspended_congress position She spreads her legs and her body moves up and down, while the man thrusts his penis in and out of her vaginal.'
const HIT_THE_FACE_LORA_ID: LoraOptionId = 'e68993e884b890e9ab98'
const HIT_THE_FACE_PROMPT =
  'dalian666,Suddenly, a baseball bat hits her face from the right side. Her head jerks sharply to the left due to the impact, and her facial expression is shocked and distorted from the external force, but there is no blood or gore. This moment is captured at the instant of impact, with motion blur on the hair and slight facial deformation, creating a dynamic, cinematic freeze-frame with a shallow depth of field and dramatic lighting effects.'
const FRENCH_KISS_LORA_ID: LoraOptionId = 'frenchkiss'
const FRENCH_KISS_PROMPT = 'Two people kiss.'
const GLASS_KISS_LORA_ID: LoraOptionId = 'e78ebbe79283'
const GLASS_KISS_PROMPT =
  'boli567,a woman is holding a transparent piece of glass, kissing it so affectionately that saliva drips down the surface.'
const CATCH_POSE_LORA_ID: LoraOptionId = 'e68a93e4bd8fe8b7aa'
const CATCH_POSE_PROMPT =
  'First-person perspective, a hand from outside reaches out to grab their neck, forcing them to kneel.'
const POV_MISSIONARY_LORA_ID: LoraOptionId = 'pov_missionary'
const POV_MISSIONARY_PROMPT =
  'with her legs spread having sex with a man, A man is thrusting his penis back and forth inside her vagina at the bottom of the screen'
const CUMSHOT_1_LORA_ID: LoraOptionId = 'cumshot_aesthetics_1'
const CUMSHOT_1_PROMPT =
  'An adult woman is kneeling. A man enters the frame from the bottom left corner. He ejaculates on her face and into her mouth, with a small amount landing on her nose. The fluid is thick and sticky, clinging like paste before sliding off.'
const CUMSHOT_2_LORA_ID: LoraOptionId = 'cumshot_aesthetics_2'
const CUMSHOT_2_PROMPT =
  'An adult woman is sitting. A naked man enters from the right side. He ejaculates on her chest. Thick and heavy, the fluid holds to her body before dripping away.'
const CUMSHOT_3_LORA_ID: LoraOptionId = 'cumshot_aesthetics_3'
const CUMSHOT_3_PROMPT =
  'An adult woman is standing. A man enters from below. He ejaculates on her mouth. The sticky fluid briefly clings before slowly sliding off her skin.'
const CUMSHOT_4_LORA_ID: LoraOptionId = 'cumshot_aesthetics_4'
const CUMSHOT_4_PROMPT =
  'An adult woman is lying down. A man enters from below. He ejaculates on her stomach. It is thick and sticky, clinging like paste before sliding off slowly.'
const BLINK_TITJOB_1_LORA_ID: LoraOptionId = 'blink_titjob_1'
const BLINK_TITJOB_1_PROMPT =
  'The video begins with a close up of an adult woman. The video then jumpcuts to the same adult woman now lying down on a tiled floor of the same location with her breasts positioned around the man\'s erect penis as he thrusts his penis up and down in a titjob motion sliding it between her breasts. She makes various facial expressions during the video, she looks like she is talking and has her eyes wide open with a crazy expression.'
const BLINK_TITJOB_2_LORA_ID: LoraOptionId = 'blink_titjob_2'
const BLINK_TITJOB_2_PROMPT =
  'The video begins with a close up of an adult woman. The video then jumpcuts to the same adult woman kneeling in the same location with her breasts positioned around the man\'s erect penis as she moves them up and down in a sliding motion. She makes various facial expressions, she looks like she is talking and has her eyes wide open with a crazy expression.'
const BLINK_BACK_DOGGYSTYLE_1_LORA_ID: LoraOptionId = 'blink_back_doggystyle_1'
const BLINK_BACK_DOGGYSTYLE_1_PROMPT =
  'The video begins with a shot of an adult woman. The video then jumpcuts to the same adult woman now having sex in doggystyle position. She is positioned kneeling in the same location. The video is shot from behind as she looks back at the camera with an open mouth expression. He penetrates her vagina from behind. Her legs are close together with the man kneeling behind her over her legs. The man has a wide stance. She is looking directly at the camera fully facing it. She looks back at the camera. She looks at the camera throughout the video.'
const BLINK_BACK_DOGGYSTYLE_2_LORA_ID: LoraOptionId = 'blink_back_doggystyle_2'
const BLINK_BACK_DOGGYSTYLE_2_PROMPT =
  'The video begins with shot of an adult woman. The video then jumpcuts to the same adult woman now having sex in doggystyle position in the same location. From an overhead perspective, she is on all fours with her back facing the camera. A man is positioned behind her, his hands gripping her hips as he penetrates her from behind. The adult woman\'s expression changes throughout the scene, showing moments of pleasure and engagement with her partner. Her legs are spread apart with the man in-between her legs. She is looking directly at the camera fully facing it. She looks back at the camera. She looks at the camera throughout the video.'
const BLINK_FACIAL_1_LORA_ID: LoraOptionId = 'blink_facial_1'
const BLINK_FACIAL_1_PROMPT =
  'The video begins with a close-up of an adult woman. The video then jumpcuts to the same adult woman now receiving a facial from a man\'s penis. She is kneeling on the floor looking up with an open mouth. The cum shoots all over her face. The man\'s hand holds his erect penis, masturbating his penis and shooting the thick white cum directly onto her face, forehead, eyes, cheek and mouth. The thick white cum slowly drips down her face onto her body. An explosion of thick white cum blasts her face. She looks directly at the camera throughout the video.'
const BLINK_FACIAL_2_LORA_ID: LoraOptionId = 'blink_facial_2'
const BLINK_FACIAL_2_PROMPT =
  'The video begins with a close-up of an adult woman. The video then jumpcuts to the same adult woman now receiving a facial from a man\'s penis. She is lying on her back. The cum shoots all over her face. The man\'s hand holds his erect penis, masturbating his penis and shooting the thick white cum directly onto her face, forehead, eyes, cheek and mouth. The thick white cum slowly drips down her face onto her body. An explosion of thick white cum blasts her face. She looks directly at the camera throughout the video.'
const BLINK_HANDJOB_1_LORA_ID: LoraOptionId = 'blink_handjob_1'
const BLINK_HANDJOB_1_PROMPT =
  'The video begins with a close-up of an adult woman. The video then jumpcuts to the same adult woman on her stomach with her head resting low in the frame on a man\'s thigh next to his penis on the left of the frame. With her right hand she grasps the man\'s erect penis and moves it up and down the shaft in a steady rhythm, performing the handjob. She goes through various facial expressions throughout the video from happy to gasping, she looks like she is talking. She looks at the camera throughout the video.'
const BLINK_HANDJOB_2_LORA_ID: LoraOptionId = 'blink_handjob_2'
const BLINK_HANDJOB_2_PROMPT =
  'The video begins with a close-up of an adult woman. The video then jumpcuts to the same adult woman now kneeling between a man\'s legs with her upper body bent forward over him, and her face close to his lap. With one hand, she grasps the man\'s erect penis and moves it up and down its shaft in a steady rhythm, performing the handjob. She goes through various facial expressions throughout the video from happy to gasping, she looks like she is talking. She looks at the camera throughout the video. The man\'s feet are seen in the background.'
const BLINK_HANDJOB_3_LORA_ID: LoraOptionId = 'blink_handjob_3'
const BLINK_HANDJOB_3_PROMPT =
  'The video begins with close-up of an adult woman. The video then jumpcuts to the same adult woman now kneeling on the floor in front of the man who is sitting high above her. She is giving the man\'s penis a handjob with both hands moving them up and down along the shaft. She goes through various facial expressions throughout the video from happy to gasping, she looks like she is talking. The adult woman is looking up at the man. She looks at the camera throughout the video.'
const PAIZURI_LORA_ID: LoraOptionId = 'pov_titfuck_paizuri'
const PAIZURI_PROMPT =
  'titJob, paizuri, nakedman and adult woman, gather, fingersTogether. A man is thrusting his penis between her breasts. She rubs her breasts up and down his penis. She gathers her breasts together around the penis, with her fingertips touching together.'
const I2PEE_LORA_ID: LoraOptionId = 'i2pee'
const I2PEE_PROMPT = 'piss'
const FRONT_DOGGY_1_LORA_ID: LoraOptionId = 'blink_front_doggystyle_1'
const FRONT_DOGGY_1_PROMPT =
  'The video begins with a close-up of an adult woman. The video then jumpcuts to the same adult woman now having sex in doggystyle position. She is lying on her stomach, facing forward, with her head turned slightly to the side as she reacts to the sensations of intercourse. Her facial expressions change throughout the sequence, showing moments of pleasure and exertion, including wide eyes, an open mouth, and clenched fists.'
const FRONT_DOGGY_2_LORA_ID: LoraOptionId = 'blink_front_doggystyle_2'
const FRONT_DOGGY_2_PROMPT =
  'The video begins with a close-up of an adult woman. The video then jumpcuts to the same adult woman now having sex with a man in doggystyle position in the same location. She is positioned standing, while the man stands behind her. The man is muscular, his hands are wrapped around the woman\'s stomach holding her upright while embracing her from behind, he holds her close as he thrusts into her. As the scene progresses, she moves rhythmically with him. She is fully nude. The man aggressively rams his hips into her.'
const FRONT_DOGGY_3_LORA_ID: LoraOptionId = 'blink_front_doggystyle_3'
const FRONT_DOGGY_3_PROMPT =
  'The video begins with a close-up of an adult woman. The video then jumpcuts to the same adult woman now having sex with a man in doggystyle position in the same location. She is bent over with her back arched and her head tilted down as he stands behind her. He is muscular. The adult woman\'s expression changes throughout the sequence as she reacts to their movements, sometimes looking down, other times up at the camera with an open mouth. The scene is recorded from below looking up. She looks at the camera the entire time. The man aggressively has sex with her. She is fully nude.'
const BLINK_BLOWJOB_LORA_ID: LoraOptionId = 'blink_blowjob'
const BLINK_BLOWJOB_PROMPT =
  'An adult woman looking at the camera. The video then jumpcuts to the same adult woman giving a blowjob to a man standing in the same location, looking up as she performs the blowjob on the man. She is kneeling in front of him, she is holding his penis with both hands. She looks at the camera the entire time. She shoves the penis deep in her mouth.'
const HANDJOB_BLOWJOB_COMBO_LORA_ID: LoraOptionId = 'handjob_blowjob_combo'
const HANDJOB_BLOWJOB_COMBO_PROMPT = BLINK_BLOWJOB_PROMPT
const BLINK_MISSIONARY_1_LORA_ID: LoraOptionId = 'blink_missionary_1'
const BLINK_MISSIONARY_1_PROMPT =
  'The video begins with a close-up of an adult woman. The video then jumpcuts to the same adult woman now having sex in missionary position. She is lying on her back on a bed with a patterned bed spread and pillow with her legs spread wide. A man\'s large penis is visible entering her vagina from below. The man is positioned kneeling between her legs in front of her thrusting his penis into her vagina. Throughout the scene, she appears to be experiencing pleasure, often with her mouth open or eyes closed as she lies back. Her hands hold onto her thighs spreading her legs.'
const BLINK_MISSIONARY_2_LORA_ID: LoraOptionId = 'blink_missionary_2'
const BLINK_MISSIONARY_2_PROMPT =
  'The video begins with a close-up of an adult woman. The video then jumpcuts to the same adult woman now having sex in missionary position. She is lying on her back on a bed with a patterned bed spread and pillow with her legs spread with her knees to her chest. A man\'s large penis is visible entering her vagina from below. The man is positioned kneeling between her legs in front of her thrusting his penis into her vagina. Throughout the scene, she appears to be experiencing pleasure, often with her mouth open or eyes closed as she lies back. Her hands hold onto her thighs spreading her legs.'
const BLINK_MISSIONARY_3_LORA_ID: LoraOptionId = 'blink_missionary_3'
const BLINK_MISSIONARY_3_PROMPT =
  'The video begins with a close-up of an adult woman. The video then jumpcuts to the same adult woman having sex in missionary position on the edge of a bed with a man\'s erect penis in her vagina. She is shown experiencing various stages of sexual pleasure, with her facial expressions changing from contentment to intense enjoyment as the act continues. She looks at the camera throughout the video.'
const SQUATTING_COWGIRL_1_LORA_ID: LoraOptionId = 'blink_squatting_cowgirl_1'
const SQUATTING_COWGIRL_1_PROMPT =
  'The video begins with a close-up of an adult woman. The video then jumpcuts to the same adult woman now having sex with a man in squatting cowgirl position. Her face fills the screen, she is leaning over forwards as she bounces up and down aggressively. His erect penis is in her vagina. She looks at the camera throughout the video. The video is shot from above looking down on the scene.'
const SQUATTING_COWGIRL_2_LORA_ID: LoraOptionId = 'blink_squatting_cowgirl_2'
const SQUATTING_COWGIRL_2_PROMPT =
  'The video begins with a close-up of an adult woman. The video then jumpcuts to the same adult woman now having sex with a man in squatting cowgirl position. She is leaning backwards as she bounces up and down aggressively. His erect penis is in her vagina. She looks at the camera throughout the video.'
const SIDELEG_TRANSITION_LORA_ID: LoraOptionId = 'sideleg_transition'
const SIDELEG_TRANSITION_PROMPT = 'They are having side sex'
const resolveVideoLengthOption = (seconds: number) =>
  VIDEO_LENGTH_OPTIONS.find((option) => option.seconds === seconds) ?? VIDEO_LENGTH_OPTIONS[0]
const OAUTH_REDIRECT_URL =
  import.meta.env.VITE_SUPABASE_REDIRECT_URL ?? (typeof window !== 'undefined' ? window.location.origin : undefined)

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const formatRemainingSeconds = (seconds: number) => {
  const safeSeconds = Math.max(0, Math.ceil(seconds))
  const hours = Math.floor(safeSeconds / 3600)
  const minutes = Math.floor((safeSeconds % 3600) / 60)
  if (hours > 0) return `${hours}時間${minutes > 0 ? `${minutes}分` : ''}`
  return `${Math.max(1, minutes)}分`
}

const withTimeout = <T,>(promise: Promise<T>, timeoutMs: number, errorMessage: string) =>
  new Promise<T>((resolve, reject) => {
    let settled = false
    const timer = window.setTimeout(() => {
      if (settled) return
      settled = true
      reject(new Error(errorMessage))
    }, timeoutMs)

    promise.then(
      (value) => {
        if (settled) return
        settled = true
        window.clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        if (settled) return
        settled = true
        window.clearTimeout(timer)
        reject(error)
      },
    )
  })

const makePipelineUsageId = () => {
  const timestamp = Date.now()
  const randomPart =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`
  const normalized = randomPart.replace(/[^A-Za-z0-9-]/g, '')
  return `media:${timestamp}:${normalized}`
}

const toBase64 = (dataUrl: string) => {
  const parts = dataUrl.split(',')
  return parts.length > 1 ? parts[1] : dataUrl
}

const blobToDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
    reader.onerror = () => reject(new Error('データ変換に失敗しました。'))
    reader.readAsDataURL(blob)
  })

const sourceToDataUrl = async (source: string) => {
  if (source.startsWith('data:')) return source
  const response = await fetch(source)
  if (!response.ok) {
    throw new Error('生成動画の取得に失敗しました。')
  }
  const blob = await response.blob()
  return blobToDataUrl(blob)
}

const sourceToBase64 = async (source: string) => {
  const dataUrl = await sourceToDataUrl(source)
  return toBase64(dataUrl)
}

const inferVideoExt = (source: string) => {
  if (source.startsWith('data:video/webm')) return '.webm'
  if (source.startsWith('data:video/quicktime')) return '.mov'
  if (source.startsWith('data:video/x-matroska')) return '.mkv'
  if (source.startsWith('data:video/x-msvideo')) return '.avi'

  try {
    const url = new URL(source)
    const path = url.pathname.toLowerCase()
    if (path.endsWith('.webm')) return '.webm'
    if (path.endsWith('.mov')) return '.mov'
    if (path.endsWith('.mkv')) return '.mkv'
    if (path.endsWith('.avi')) return '.avi'
  } catch {
    // no-op
  }
  return '.mp4'
}

const withLoraPromptAdditions = (prompt: string, loras: readonly { id: LoraOptionId }[]) => {
  let nextPrompt = prompt.trim()
  if (loras.some((lora) => lora.id === SCREEN_FLOOD_LORA_ID)) {
    if (!new RegExp(`(^|\\s|,)${SCREEN_FLOOD_TRIGGER}(\\s|,|$)`, 'i').test(nextPrompt)) {
      nextPrompt = nextPrompt ? `${SCREEN_FLOOD_TRIGGER}, ${nextPrompt}` : SCREEN_FLOOD_TRIGGER
    }
    if (!nextPrompt.toLowerCase().includes(SCREEN_FLOOD_PROMPT.toLowerCase())) {
      nextPrompt = nextPrompt ? `${nextPrompt} ${SCREEN_FLOOD_PROMPT}` : SCREEN_FLOOD_PROMPT
    }
  }
  if (loras.some((lora) => lora.id === LIFT_ONE_LEG_LORA_ID)) {
    if (!nextPrompt.toLowerCase().includes(LIFT_ONE_LEG_PROMPT.toLowerCase())) {
      nextPrompt = nextPrompt ? `${nextPrompt} ${LIFT_ONE_LEG_PROMPT}` : LIFT_ONE_LEG_PROMPT
    }
  }
  if (loras.some((lora) => lora.id === FACE_DOWN_ASS_UP_LORA_ID)) {
    if (!nextPrompt.toLowerCase().includes(FACE_DOWN_ASS_UP_PROMPT.toLowerCase())) {
      nextPrompt = nextPrompt ? `${nextPrompt} ${FACE_DOWN_ASS_UP_PROMPT}` : FACE_DOWN_ASS_UP_PROMPT
    }
  }
  if (loras.some((lora) => lora.id === SUSPENDED_CONGRESS_LORA_ID)) {
    if (!nextPrompt.toLowerCase().includes(SUSPENDED_CONGRESS_PROMPT.toLowerCase())) {
      nextPrompt = nextPrompt ? `${nextPrompt} ${SUSPENDED_CONGRESS_PROMPT}` : SUSPENDED_CONGRESS_PROMPT
    }
  }
  if (loras.some((lora) => lora.id === HIT_THE_FACE_LORA_ID)) {
    if (!nextPrompt.toLowerCase().includes(HIT_THE_FACE_PROMPT.toLowerCase())) {
      nextPrompt = nextPrompt ? `${nextPrompt} ${HIT_THE_FACE_PROMPT}` : HIT_THE_FACE_PROMPT
    }
  }
  if (loras.some((lora) => lora.id === FRENCH_KISS_LORA_ID)) {
    if (!nextPrompt.toLowerCase().includes(FRENCH_KISS_PROMPT.toLowerCase())) {
      nextPrompt = nextPrompt ? `${nextPrompt} ${FRENCH_KISS_PROMPT}` : FRENCH_KISS_PROMPT
    }
  }
  if (loras.some((lora) => lora.id === GLASS_KISS_LORA_ID)) {
    if (!nextPrompt.toLowerCase().includes(GLASS_KISS_PROMPT.toLowerCase())) {
      nextPrompt = nextPrompt ? `${nextPrompt} ${GLASS_KISS_PROMPT}` : GLASS_KISS_PROMPT
    }
  }
  if (loras.some((lora) => lora.id === CATCH_POSE_LORA_ID)) {
    if (!nextPrompt.toLowerCase().includes(CATCH_POSE_PROMPT.toLowerCase())) {
      nextPrompt = nextPrompt ? `${nextPrompt} ${CATCH_POSE_PROMPT}` : CATCH_POSE_PROMPT
    }
  }
  if (loras.some((lora) => lora.id === POV_MISSIONARY_LORA_ID)) {
    if (!nextPrompt.toLowerCase().includes(POV_MISSIONARY_PROMPT.toLowerCase())) {
      nextPrompt = nextPrompt ? `${nextPrompt} ${POV_MISSIONARY_PROMPT}` : POV_MISSIONARY_PROMPT
    }
  }
  if (loras.some((lora) => lora.id === CUMSHOT_1_LORA_ID)) {
    if (!nextPrompt.toLowerCase().includes(CUMSHOT_1_PROMPT.toLowerCase())) {
      nextPrompt = nextPrompt ? `${nextPrompt} ${CUMSHOT_1_PROMPT}` : CUMSHOT_1_PROMPT
    }
  }
  if (loras.some((lora) => lora.id === CUMSHOT_2_LORA_ID)) {
    if (!nextPrompt.toLowerCase().includes(CUMSHOT_2_PROMPT.toLowerCase())) {
      nextPrompt = nextPrompt ? `${nextPrompt} ${CUMSHOT_2_PROMPT}` : CUMSHOT_2_PROMPT
    }
  }
  if (loras.some((lora) => lora.id === CUMSHOT_3_LORA_ID)) {
    if (!nextPrompt.toLowerCase().includes(CUMSHOT_3_PROMPT.toLowerCase())) {
      nextPrompt = nextPrompt ? `${nextPrompt} ${CUMSHOT_3_PROMPT}` : CUMSHOT_3_PROMPT
    }
  }
  if (loras.some((lora) => lora.id === CUMSHOT_4_LORA_ID)) {
    if (!nextPrompt.toLowerCase().includes(CUMSHOT_4_PROMPT.toLowerCase())) {
      nextPrompt = nextPrompt ? `${nextPrompt} ${CUMSHOT_4_PROMPT}` : CUMSHOT_4_PROMPT
    }
  }
  if (loras.some((lora) => lora.id === BLINK_TITJOB_1_LORA_ID)) {
    if (!nextPrompt.toLowerCase().includes(BLINK_TITJOB_1_PROMPT.toLowerCase())) {
      nextPrompt = nextPrompt ? `${nextPrompt} ${BLINK_TITJOB_1_PROMPT}` : BLINK_TITJOB_1_PROMPT
    }
  }
  if (loras.some((lora) => lora.id === BLINK_TITJOB_2_LORA_ID)) {
    if (!nextPrompt.toLowerCase().includes(BLINK_TITJOB_2_PROMPT.toLowerCase())) {
      nextPrompt = nextPrompt ? `${nextPrompt} ${BLINK_TITJOB_2_PROMPT}` : BLINK_TITJOB_2_PROMPT
    }
  }
  if (loras.some((lora) => lora.id === BLINK_BACK_DOGGYSTYLE_1_LORA_ID)) {
    if (!nextPrompt.toLowerCase().includes(BLINK_BACK_DOGGYSTYLE_1_PROMPT.toLowerCase())) {
      nextPrompt = nextPrompt ? `${nextPrompt} ${BLINK_BACK_DOGGYSTYLE_1_PROMPT}` : BLINK_BACK_DOGGYSTYLE_1_PROMPT
    }
  }
  if (loras.some((lora) => lora.id === BLINK_BACK_DOGGYSTYLE_2_LORA_ID)) {
    if (!nextPrompt.toLowerCase().includes(BLINK_BACK_DOGGYSTYLE_2_PROMPT.toLowerCase())) {
      nextPrompt = nextPrompt ? `${nextPrompt} ${BLINK_BACK_DOGGYSTYLE_2_PROMPT}` : BLINK_BACK_DOGGYSTYLE_2_PROMPT
    }
  }
  if (loras.some((lora) => lora.id === BLINK_FACIAL_1_LORA_ID)) {
    if (!nextPrompt.toLowerCase().includes(BLINK_FACIAL_1_PROMPT.toLowerCase())) {
      nextPrompt = nextPrompt ? `${nextPrompt} ${BLINK_FACIAL_1_PROMPT}` : BLINK_FACIAL_1_PROMPT
    }
  }
  if (loras.some((lora) => lora.id === BLINK_FACIAL_2_LORA_ID)) {
    if (!nextPrompt.toLowerCase().includes(BLINK_FACIAL_2_PROMPT.toLowerCase())) {
      nextPrompt = nextPrompt ? `${nextPrompt} ${BLINK_FACIAL_2_PROMPT}` : BLINK_FACIAL_2_PROMPT
    }
  }
  if (loras.some((lora) => lora.id === BLINK_HANDJOB_1_LORA_ID)) {
    if (!nextPrompt.toLowerCase().includes(BLINK_HANDJOB_1_PROMPT.toLowerCase())) {
      nextPrompt = nextPrompt ? `${nextPrompt} ${BLINK_HANDJOB_1_PROMPT}` : BLINK_HANDJOB_1_PROMPT
    }
  }
  if (loras.some((lora) => lora.id === BLINK_HANDJOB_2_LORA_ID)) {
    if (!nextPrompt.toLowerCase().includes(BLINK_HANDJOB_2_PROMPT.toLowerCase())) {
      nextPrompt = nextPrompt ? `${nextPrompt} ${BLINK_HANDJOB_2_PROMPT}` : BLINK_HANDJOB_2_PROMPT
    }
  }
  if (loras.some((lora) => lora.id === BLINK_HANDJOB_3_LORA_ID)) {
    if (!nextPrompt.toLowerCase().includes(BLINK_HANDJOB_3_PROMPT.toLowerCase())) {
      nextPrompt = nextPrompt ? `${nextPrompt} ${BLINK_HANDJOB_3_PROMPT}` : BLINK_HANDJOB_3_PROMPT
    }
  }
  if (loras.some((lora) => lora.id === PAIZURI_LORA_ID)) {
    if (!nextPrompt.toLowerCase().includes(PAIZURI_PROMPT.toLowerCase())) {
      nextPrompt = nextPrompt ? `${nextPrompt} ${PAIZURI_PROMPT}` : PAIZURI_PROMPT
    }
  }
  if (loras.some((lora) => lora.id === I2PEE_LORA_ID)) {
    if (!new RegExp(`(^|\\s|,)${I2PEE_PROMPT}(\\s|,|$)`, 'i').test(nextPrompt)) {
      nextPrompt = nextPrompt ? `${nextPrompt} ${I2PEE_PROMPT}` : I2PEE_PROMPT
    }
  }
  if (loras.some((lora) => lora.id === FRONT_DOGGY_1_LORA_ID)) {
    if (!nextPrompt.toLowerCase().includes(FRONT_DOGGY_1_PROMPT.toLowerCase())) {
      nextPrompt = nextPrompt ? `${nextPrompt} ${FRONT_DOGGY_1_PROMPT}` : FRONT_DOGGY_1_PROMPT
    }
  }
  if (loras.some((lora) => lora.id === FRONT_DOGGY_2_LORA_ID)) {
    if (!nextPrompt.toLowerCase().includes(FRONT_DOGGY_2_PROMPT.toLowerCase())) {
      nextPrompt = nextPrompt ? `${nextPrompt} ${FRONT_DOGGY_2_PROMPT}` : FRONT_DOGGY_2_PROMPT
    }
  }
  if (loras.some((lora) => lora.id === FRONT_DOGGY_3_LORA_ID)) {
    if (!nextPrompt.toLowerCase().includes(FRONT_DOGGY_3_PROMPT.toLowerCase())) {
      nextPrompt = nextPrompt ? `${nextPrompt} ${FRONT_DOGGY_3_PROMPT}` : FRONT_DOGGY_3_PROMPT
    }
  }
  if (loras.some((lora) => lora.id === HANDJOB_BLOWJOB_COMBO_LORA_ID)) {
    if (!nextPrompt.toLowerCase().includes(HANDJOB_BLOWJOB_COMBO_PROMPT.toLowerCase())) {
      nextPrompt = nextPrompt ? `${nextPrompt} ${HANDJOB_BLOWJOB_COMBO_PROMPT}` : HANDJOB_BLOWJOB_COMBO_PROMPT
    }
  }
  if (loras.some((lora) => lora.id === BLINK_BLOWJOB_LORA_ID)) {
    if (!nextPrompt.toLowerCase().includes(BLINK_BLOWJOB_PROMPT.toLowerCase())) {
      nextPrompt = nextPrompt ? `${nextPrompt} ${BLINK_BLOWJOB_PROMPT}` : BLINK_BLOWJOB_PROMPT
    }
  }
  if (loras.some((lora) => lora.id === BLINK_MISSIONARY_1_LORA_ID)) {
    if (!nextPrompt.toLowerCase().includes(BLINK_MISSIONARY_1_PROMPT.toLowerCase())) {
      nextPrompt = nextPrompt ? `${nextPrompt} ${BLINK_MISSIONARY_1_PROMPT}` : BLINK_MISSIONARY_1_PROMPT
    }
  }
  if (loras.some((lora) => lora.id === BLINK_MISSIONARY_2_LORA_ID)) {
    if (!nextPrompt.toLowerCase().includes(BLINK_MISSIONARY_2_PROMPT.toLowerCase())) {
      nextPrompt = nextPrompt ? `${nextPrompt} ${BLINK_MISSIONARY_2_PROMPT}` : BLINK_MISSIONARY_2_PROMPT
    }
  }
  if (loras.some((lora) => lora.id === BLINK_MISSIONARY_3_LORA_ID)) {
    if (!nextPrompt.toLowerCase().includes(BLINK_MISSIONARY_3_PROMPT.toLowerCase())) {
      nextPrompt = nextPrompt ? `${nextPrompt} ${BLINK_MISSIONARY_3_PROMPT}` : BLINK_MISSIONARY_3_PROMPT
    }
  }
  if (loras.some((lora) => lora.id === SQUATTING_COWGIRL_1_LORA_ID)) {
    if (!nextPrompt.toLowerCase().includes(SQUATTING_COWGIRL_1_PROMPT.toLowerCase())) {
      nextPrompt = nextPrompt ? `${nextPrompt} ${SQUATTING_COWGIRL_1_PROMPT}` : SQUATTING_COWGIRL_1_PROMPT
    }
  }
  if (loras.some((lora) => lora.id === SQUATTING_COWGIRL_2_LORA_ID)) {
    if (!nextPrompt.toLowerCase().includes(SQUATTING_COWGIRL_2_PROMPT.toLowerCase())) {
      nextPrompt = nextPrompt ? `${nextPrompt} ${SQUATTING_COWGIRL_2_PROMPT}` : SQUATTING_COWGIRL_2_PROMPT
    }
  }
  if (loras.some((lora) => lora.id === SIDELEG_TRANSITION_LORA_ID)) {
    if (!nextPrompt.toLowerCase().includes(SIDELEG_TRANSITION_PROMPT.toLowerCase())) {
      nextPrompt = nextPrompt ? `${nextPrompt} ${SIDELEG_TRANSITION_PROMPT}` : SIDELEG_TRANSITION_PROMPT
    }
  }
  return nextPrompt
}

const normalizeVideo = (value: unknown, filename?: string) => {
  if (typeof value !== 'string' || !value) return null
  if (value.startsWith('data:') || value.startsWith('http')) return value
  const ext = filename?.split('.').pop()?.toLowerCase()
  const mime =
    ext === 'webm' ? 'video/webm' : ext === 'gif' ? 'image/gif' : ext === 'mp4' ? 'video/mp4' : 'video/mp4'
  return `data:${mime};base64,${value}`
}

const isVideoLike = (value: unknown, filename?: string) => {
  const ext = filename?.split('.').pop()?.toLowerCase()
  if (ext && ['mp4', 'webm', 'gif'].includes(ext)) return true
  if (typeof value !== 'string') return false
  return value.startsWith('data:video/') || value.startsWith('data:image/gif')
}

const extractVideoList = (payload: any) => {
  const output = payload?.output ?? payload?.result ?? payload
  const nested = output?.output ?? output?.result ?? output?.data ?? payload?.output?.output ?? payload?.result?.output
  const listCandidates = [
    output?.videos,
    output?.outputs,
    output?.output_videos,
    output?.gifs,
    output?.images,
    payload?.videos,
    payload?.gifs,
    payload?.images,
    nested?.videos,
    nested?.outputs,
    nested?.output_videos,
    nested?.gifs,
    nested?.images,
    nested?.data,
  ]

  for (const candidate of listCandidates) {
    if (!Array.isArray(candidate)) continue
    const normalized = candidate
      .map((item: any) => {
        const raw = item?.video ?? item?.data ?? item?.url ?? item
        const name = item?.filename
        if (!isVideoLike(raw, name)) return null
        return normalizeVideo(raw, name)
      })
      .filter(Boolean) as string[]
    if (normalized.length) return normalized
  }

  return []
}

const extractVideo = (payload: any) => {
  if (!payload || typeof payload !== 'object') return null

  if (typeof payload.video === 'string' && payload.video) {
    if (payload.video.startsWith('data:video/')) return payload.video
    return `data:video/mp4;base64,${payload.video}`
  }

  const roots = [
    payload,
    payload?.output,
    payload?.result,
    payload?.output?.output,
    payload?.result?.output,
    payload?.upstream,
    payload?.upstream?.output,
  ]

  for (const root of roots) {
    if (!root || typeof root !== 'object') continue
    const direct =
      root.output_base64 ||
      root.video_base64 ||
      root.output?.output_base64 ||
      root.output?.video_base64
    if (typeof direct === 'string' && direct) {
      return direct.startsWith('data:video/') ? direct : `data:video/mp4;base64,${direct}`
    }
  }

  return null
}

const extractErrorMessage = (payload: any) =>
  payload?.error ||
  payload?.message ||
  payload?.output?.error ||
  payload?.result?.error ||
  payload?.output?.output?.error ||
  payload?.result?.output?.error

const normalizeErrorMessage = (value: unknown) => {
  if (!value) return 'リクエストに失敗しました。'

  if (typeof value === 'object') {
    const maybe = value as { error?: unknown; message?: unknown; detail?: unknown }
    const picked = maybe?.error ?? maybe?.message ?? maybe?.detail
    if (typeof picked === 'string' && picked) return picked
    if (value instanceof Error && value.message) return value.message
  }

  const raw = typeof value === 'string' ? value : value instanceof Error ? value.message : String(value)
  const lowered = raw.toLowerCase()
  if (
    lowered.includes('out of memory') ||
    lowered.includes('would exceed allowed memory') ||
    lowered.includes('allocation on device') ||
    lowered.includes('cuda') ||
    lowered.includes('oom')
  ) {
    return 'GPUメモリ不足です。画像サイズを小さくして再試行してください。'
  }

  const trimmed = raw.trim()
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try {
      const parsed = JSON.parse(trimmed)
      const message = parsed?.error || parsed?.message || parsed?.detail
      if (typeof message === 'string' && message) return message
    } catch {
      // ignore parse errors
    }
  }

  return raw
}

const isTicketShortage = (status: number, message: string) => {
  if (status === 402) return true
  const lowered = message.toLowerCase()
  return (
    lowered.includes('no ticket') ||
    lowered.includes('no tickets') ||
    lowered.includes('insufficient_tickets') ||
    lowered.includes('insufficient tickets') ||
    lowered.includes('token') ||
    lowered.includes('credit')
  )
}

const isFailureStatus = (status: string) => {
  const normalized = status.toLowerCase()
  return normalized.includes('fail') || normalized.includes('error') || normalized.includes('cancel')
}

const isRetryableStatusCheck = (status: number) => {
  if (status === 0 || status === 401 || status === 404 || status === 408 || status === 409 || status === 425 || status === 429) return true
  return status >= 500
}

const extractJobId = (payload: any) => payload?.id || payload?.jobId || payload?.job_id || payload?.output?.id

const alignTo16 = (value: number) => Math.max(16, Math.round(value / 16) * 16)
const PORTRAIT_MAX = { width: 464, height: 640 }
const LANDSCAPE_MAX = { width: 640, height: 464 }

const fitWithinBounds = (width: number, height: number, maxWidth: number, maxHeight: number) => {
  const scale = Math.min(1, maxWidth / width, maxHeight / height)
  const scaledWidth = width * scale
  const scaledHeight = height * scale
  const aspect = width / height

  if (aspect >= 1) {
    const targetWidth = Math.min(maxWidth, alignTo16(scaledWidth))
    const targetHeight = Math.min(maxHeight, alignTo16(targetWidth / aspect))
    return { width: targetWidth, height: targetHeight }
  }

  const targetHeight = Math.min(maxHeight, alignTo16(scaledHeight))
  const targetWidth = Math.min(maxWidth, alignTo16(targetHeight * aspect))
  return { width: targetWidth, height: targetHeight }
}

const getTargetSize = (width: number, height: number) => {
  const isPortrait = height >= width
  const bounds = isPortrait ? PORTRAIT_MAX : LANDSCAPE_MAX
  return fitWithinBounds(width, height, bounds.width, bounds.height)
}

const buildPaddedDataUrl = (img: HTMLImageElement, targetWidth: number, targetHeight: number) => {
  const canvas = document.createElement('canvas')
  canvas.width = targetWidth
  canvas.height = targetHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  // Keep full source frame by fitting with letterbox instead of stretching/cropping.
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, targetWidth, targetHeight)
  const scale = Math.min(targetWidth / img.naturalWidth, targetHeight / img.naturalHeight)
  const drawWidth = Math.max(1, Math.round(img.naturalWidth * scale))
  const drawHeight = Math.max(1, Math.round(img.naturalHeight * scale))
  const offsetX = Math.floor((targetWidth - drawWidth) / 2)
  const offsetY = Math.floor((targetHeight - drawHeight) / 2)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, offsetX, offsetY, drawWidth, drawHeight)
  return canvas.toDataURL('image/png')
}

const waitForVideoMetadata = (
  el: HTMLVideoElement,
  src: string,
  errorMessage: string,
  timeoutMs = 15_000,
) =>
  new Promise<void>((resolve, reject) => {
    let settled = false
    let timer: number | null = null

    const cleanup = () => {
      el.removeEventListener('loadedmetadata', onLoaded)
      el.removeEventListener('error', onError)
      if (timer !== null) {
        window.clearTimeout(timer)
      }
    }

    const finalizeResolve = () => {
      if (settled) return
      settled = true
      cleanup()
      resolve()
    }

    const finalizeReject = (message: string) => {
      if (settled) return
      settled = true
      cleanup()
      reject(new Error(message))
    }

    const onLoaded = () => finalizeResolve()
    const onError = () => finalizeReject(errorMessage)

    // Register listeners before assigning src so very small files do not miss the event.
    el.addEventListener('loadedmetadata', onLoaded, { once: true })
    el.addEventListener('error', onError, { once: true })
    el.src = src

    if (el.readyState >= HTMLMediaElement.HAVE_METADATA) {
      finalizeResolve()
      return
    }

    el.load()
    timer = window.setTimeout(() => finalizeReject(errorMessage), timeoutMs)
  })

const startMediaElementPlayback = async (el: HTMLMediaElement, timeoutMs = 2_000) => {
  try {
    const playResult = el.play()
    if (playResult && typeof (playResult as Promise<void>).then === 'function') {
      await Promise.race([playResult, wait(timeoutMs)])
    }
  } catch {
    // Autoplay restrictions or transient playback failures should not block final mux.
  }
}

type SyncedVideoPlayerProps = {
  videoSrc: string
  audioSrc: string
}

const SyncedVideoPlayer = ({ videoSrc, audioSrc }: SyncedVideoPlayerProps) => {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    const videoEl = videoRef.current
    const audioEl = audioRef.current
    if (!videoEl || !audioEl) return

    let isSyncing = false

    const syncTime = () => {
      if (isSyncing) return
      if (!Number.isFinite(videoEl.currentTime) || !Number.isFinite(audioEl.currentTime)) return
      const drift = Math.abs(videoEl.currentTime - audioEl.currentTime)
      if (drift < 0.12) return
      isSyncing = true
      try {
        audioEl.currentTime = videoEl.currentTime
      } finally {
        isSyncing = false
      }
    }

    const syncPlaybackState = async () => {
      syncTime()
      audioEl.playbackRate = videoEl.playbackRate
      audioEl.volume = videoEl.volume
      audioEl.muted = videoEl.muted
      if (!videoEl.paused) {
        try {
          await audioEl.play()
        } catch {
          // Ignore autoplay/playback race failures; next user interaction will retry.
        }
      }
    }

    const handlePause = () => {
      audioEl.pause()
      syncTime()
    }

    const handleEnded = () => {
      audioEl.pause()
      audioEl.currentTime = 0
    }

    const handleVolumeChange = () => {
      audioEl.volume = videoEl.volume
      audioEl.muted = videoEl.muted
    }

    const handleRateChange = () => {
      audioEl.playbackRate = videoEl.playbackRate
    }

    const handleSeeked = () => {
      syncTime()
      if (!videoEl.paused) {
        void audioEl.play().catch(() => undefined)
      }
    }

    videoEl.addEventListener('play', syncPlaybackState)
    videoEl.addEventListener('playing', syncPlaybackState)
    videoEl.addEventListener('pause', handlePause)
    videoEl.addEventListener('seeking', syncTime)
    videoEl.addEventListener('seeked', handleSeeked)
    videoEl.addEventListener('timeupdate', syncTime)
    videoEl.addEventListener('ratechange', handleRateChange)
    videoEl.addEventListener('volumechange', handleVolumeChange)
    videoEl.addEventListener('ended', handleEnded)

    audioEl.preload = 'auto'
    audioEl.currentTime = 0
    audioEl.playbackRate = videoEl.playbackRate
    audioEl.volume = videoEl.volume
    audioEl.muted = videoEl.muted

    return () => {
      videoEl.removeEventListener('play', syncPlaybackState)
      videoEl.removeEventListener('playing', syncPlaybackState)
      videoEl.removeEventListener('pause', handlePause)
      videoEl.removeEventListener('seeking', syncTime)
      videoEl.removeEventListener('seeked', handleSeeked)
      videoEl.removeEventListener('timeupdate', syncTime)
      videoEl.removeEventListener('ratechange', handleRateChange)
      videoEl.removeEventListener('volumechange', handleVolumeChange)
      videoEl.removeEventListener('ended', handleEnded)
      audioEl.pause()
      audioEl.currentTime = 0
    }
  }, [audioSrc, videoSrc])

  return (
    <>
      <video ref={videoRef} controls controlsList="nodownload" src={videoSrc} />
      <audio ref={audioRef} src={audioSrc} />
    </>
  )
}

export function Video() {
  const [sourcePreview, setSourcePreview] = useState<string | null>(null)
  const [sourcePayload, setSourcePayload] = useState<string | null>(null)
  const [sourceName, setSourceName] = useState('')
  const [prompt, setPrompt] = useState('')
  const [isSfxEnabled, setIsSfxEnabled] = useState(false)
  const [sfxPrompt, setSfxPrompt] = useState('')
  const [negativePrompt, setNegativePrompt] = useState('')
  const [loraStrengths, setLoraStrengths] = useState<Partial<Record<LoraOptionId, number>>>({})
  const [videoLengthSeconds, setVideoLengthSeconds] = useState<VideoLengthSeconds>(DEFAULT_VIDEO_LENGTH_SECONDS as VideoLengthSeconds)
  const [width, setWidth] = useState(832)
  const [height, setHeight] = useState(576)
  const [displayVideo, setDisplayVideo] = useState<string | null>(null)
  const [displayAudioVideo, setDisplayAudioVideo] = useState<string | null>(null)
  const [displayPipelineUsageId, setDisplayPipelineUsageId] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState('')
  const [isRunning, setIsRunning] = useState(false)
  const [session, setSession] = useState<Session | null>(null)
  const [authReady, setAuthReady] = useState(!supabase)
  const [ticketCount, setTicketCount] = useState<number | null>(null)
  const [ticketStatus, setTicketStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [ticketMessage, setTicketMessage] = useState('')
  const [dailyBonusStatus, setDailyBonusStatus] = useState<'idle' | 'loading' | 'ready' | 'cooldown' | 'error'>('idle')
  const [dailyBonusMessage, setDailyBonusMessage] = useState('')
  const [dailyBonusRefreshAt, setDailyBonusRefreshAt] = useState<string | null>(null)
  const [isClaimingDailyBonus, setIsClaimingDailyBonus] = useState(false)
  const [isPremiumMember, setIsPremiumMember] = useState(false)
  const [showTicketModal, setShowTicketModal] = useState(false)
  const [errorModalMessage, setErrorModalMessage] = useState<string | null>(null)
  const [isSavingResult, setIsSavingResult] = useState(false)
  const runIdRef = useRef(0)

  const accessToken = session?.access_token ?? ''
  const selectedVideoModel = VIDEO_MODELS[DEFAULT_VIDEO_MODEL]
  const selectedVideoLength = useMemo(() => resolveVideoLengthOption(videoLengthSeconds), [videoLengthSeconds])
  const selectedLoras = useMemo(
    () =>
      LORA_OPTIONS
        .map((option) => ({
          id: option.id,
          strength: Number(loraStrengths[option.id] ?? DEFAULT_LORA_STRENGTH),
        }))
        .filter(
          (selection) =>
            selection.strength >= ACTIVE_LORA_STRENGTH && (isPremiumMember || !isPremiumLoraOption(selection.id)),
        ),
    [isPremiumMember, loraStrengths],
  )
  const videoPromptForGeneration = useMemo(() => withLoraPromptAdditions(prompt, selectedLoras), [prompt, selectedLoras])
  const soundPromptForGeneration = sfxPrompt.trim()
  const hasSfxPrompt = isSfxEnabled && soundPromptForGeneration.length > 0
  const audioPipelineCost = isSfxEnabled ? 1 : 0
  const requiredPoints = selectedVideoLength.ticketCost + audioPipelineCost
  const requiredPointsForRun = requiredPoints
  const canGenerate = Boolean(
    sourcePayload &&
      videoPromptForGeneration.trim() &&
      (!isSfxEnabled || soundPromptForGeneration) &&
      !isRunning &&
      session,
  )
  const isGif = displayVideo?.startsWith('data:image/gif')
  const loadingSubtitle = useMemo(() => {
    if (hasSfxPrompt) {
      return '動画生成 → sound生成を実行中です。'
    }
    return '動画生成を実行中です。'
  }, [hasSfxPrompt])

  const viewerStyle = useMemo(
    () =>
      ({
        '--studio-aspect': `${Math.max(1, width)} / ${Math.max(1, height)}`,
      }) as CSSProperties,
    [height, width],
  )

  const updateLoraStrength = useCallback(
    (id: LoraOptionId, value: number) => {
      if (!isPremiumMember && isPremiumLoraOption(id)) {
        setStatusMessage('このLoRAはPremiumメンバー限定です。')
        return
      }
      const normalized = Math.min(MAX_LORA_STRENGTH, Math.max(MIN_LORA_STRENGTH, Math.round(value * 100) / 100))
      setLoraStrengths((prev) => {
        if (normalized < ACTIVE_LORA_STRENGTH) {
          if (prev[id] === undefined) return prev
          const next = { ...prev }
          delete next[id]
          return next
        }
        return { ...prev, [id]: normalized }
      })
    },
    [isPremiumMember],
  )

  useEffect(() => {
    if (!supabase) {
      setAuthReady(true)
      return
    }

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session ?? null)
      setAuthReady(true)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      setAuthReady(true)
    })

    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!supabase) return
    const hasCode = typeof window !== 'undefined' && window.location.search.includes('code=')
    const hasState = typeof window !== 'undefined' && window.location.search.includes('state=')
    if (!hasCode || !hasState) return

    supabase.auth.exchangeCodeForSession(window.location.href).then(({ error }) => {
      if (error) {
        window.alert(error.message)
        return
      }
      const url = new URL(window.location.href)
      url.searchParams.delete('code')
      url.searchParams.delete('state')
      window.history.replaceState({}, document.title, url.toString())
    })
  }, [])

  const fetchTickets = useCallback(async () => {
    setTicketStatus('loading')
    setTicketMessage('')

    const res = await fetchWithAuth('/api/tickets')
    const data = await res.json().catch(() => ({}))

    if (!res.ok) {
      setTicketStatus('error')
      setTicketMessage(data?.error || 'クレジット情報の取得に失敗しました。')
      setTicketCount(null)
      setIsPremiumMember(false)
      return null
    }

    const nextCount = Number(data?.tickets ?? 0)
    setTicketStatus('idle')
    setTicketMessage('')
    setTicketCount(nextCount)
    setIsPremiumMember(Boolean(data?.premium_member ?? data?.premiumMember))
    return nextCount
  }, [])

  const fetchDailyBonusStatus = useCallback(async () => {
    setDailyBonusStatus('loading')
    setDailyBonusMessage('')
    setDailyBonusRefreshAt(null)

    try {
      const res = await fetchWithAuth('/api/daily-bonus')
      const data = (await res.json().catch(() => ({}))) as DailyBonusResponse

      if (!res.ok) {
        setDailyBonusStatus('error')
        setDailyBonusMessage(data?.error || 'ボーナス情報の取得に失敗しました。')
        return
      }

      if (data?.can_claim) {
        setDailyBonusStatus('ready')
        setDailyBonusMessage(`${data.amount ?? 1}クレジット受け取り可能`)
        return
      }

      const remainingSeconds = Number(data?.remaining_seconds ?? 0)
      setDailyBonusStatus('cooldown')
      setDailyBonusRefreshAt(data?.next_eligible_at ?? null)
      setDailyBonusMessage(`次の受け取りまで約${formatRemainingSeconds(remainingSeconds)}`)
    } catch {
      setDailyBonusStatus('error')
      setDailyBonusMessage('ボーナス情報の取得に失敗しました。')
    }
  }, [])

  useEffect(() => {
    if (!session || !accessToken) {
      setTicketCount(null)
      setTicketStatus('idle')
      setTicketMessage('')
      setDailyBonusStatus('idle')
      setDailyBonusMessage('')
      setDailyBonusRefreshAt(null)
      setIsClaimingDailyBonus(false)
      setIsPremiumMember(false)
      return
    }
    void fetchTickets()
    void fetchDailyBonusStatus()
  }, [accessToken, fetchDailyBonusStatus, fetchTickets, session])

  useEffect(() => {
    if (!session || dailyBonusStatus !== 'cooldown' || !dailyBonusRefreshAt) return

    const refreshAtMs = new Date(dailyBonusRefreshAt).getTime()
    if (!Number.isFinite(refreshAtMs)) return

    const delayMs = refreshAtMs - Date.now()
    if (delayMs <= 0) {
      void fetchDailyBonusStatus()
      return
    }

    const timerId = window.setTimeout(() => void fetchDailyBonusStatus(), delayMs + 1000)
    return () => window.clearTimeout(timerId)
  }, [dailyBonusRefreshAt, dailyBonusStatus, fetchDailyBonusStatus, session])

  const handleGoogleSignIn = useCallback(async () => {
    if (isRunning) return
    if (!supabase || !isAuthConfigured) {
      setStatusMessage('認証設定が未完了です。')
      return
    }

    setStatusMessage('Googleログインへ移動します…')
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: OAUTH_REDIRECT_URL, skipBrowserRedirect: true },
    })
    if (error) {
      setStatusMessage(error.message)
      return
    }
    if (data?.url) {
      window.location.assign(data.url)
      return
    }
    setStatusMessage('認証URLの取得に失敗しました。')
  }, [isRunning])

  const handleSignOut = useCallback(async () => {
    if (!supabase || isRunning) return
    await supabase.auth.signOut({ scope: 'local' })
    setSession(null)
    setTicketCount(null)
    setTicketStatus('idle')
    setTicketMessage('')
    setDailyBonusStatus('idle')
    setDailyBonusMessage('')
    setDailyBonusRefreshAt(null)
    setIsClaimingDailyBonus(false)
    window.location.assign('/')
  }, [isRunning])

  const handleClaimDailyBonus = useCallback(async () => {
    if (!session || isClaimingDailyBonus) return

    setIsClaimingDailyBonus(true)
    setDailyBonusStatus('loading')
    setDailyBonusMessage('')
    setDailyBonusRefreshAt(null)

    try {
      const res = await fetchWithAuth('/api/daily-bonus', { method: 'POST' })
      const data = (await res.json().catch(() => ({}))) as DailyBonusResponse

      if (!res.ok) {
        setDailyBonusStatus('error')
        setDailyBonusMessage(data?.error || 'ボーナス受け取りに失敗しました。')
        return
      }

      const ticketsLeft = Number(data?.tickets_left)
      if (Number.isFinite(ticketsLeft)) {
        setTicketCount(ticketsLeft)
      }

      if (data?.granted) {
        setDailyBonusStatus('cooldown')
        setDailyBonusRefreshAt(data?.next_eligible_at ?? null)
        setDailyBonusMessage(`${data.amount ?? 1}クレジットを受け取りました。`)
        void fetchTickets()
        window.setTimeout(() => void fetchDailyBonusStatus(), 800)
        return
      }

      const remainingSeconds = Number(data?.remaining_seconds ?? 0)
      setDailyBonusStatus('cooldown')
      setDailyBonusRefreshAt(data?.next_eligible_at ?? null)
      setDailyBonusMessage(`次の受け取りまで約${formatRemainingSeconds(remainingSeconds)}`)
    } catch {
      setDailyBonusStatus('error')
      setDailyBonusMessage('ボーナス受け取りに失敗しました。')
    } finally {
      setIsClaimingDailyBonus(false)
    }
  }, [fetchDailyBonusStatus, fetchTickets, isClaimingDailyBonus, session])

  const submitVideo = useCallback(
    async (imagePayload: string): Promise<SubmitVideoResult> => {
      if (!imagePayload) throw new Error('画像が必要です。')

      const input: Record<string, unknown> = {
        mode: 'i2v',
        prompt: videoPromptForGeneration,
        negative_prompt: negativePrompt,
        width,
        height,
        fps: FIXED_FPS,
        seconds: selectedVideoLength.seconds,
        num_frames: selectedVideoLength.frames,
        steps: FIXED_STEPS,
        cfg: FIXED_CFG,
        seed: 0,
        randomize_seed: true,
        worker_mode: 'comfyui',
        image_name: sourceName || 'input.png',
      }
      if (selectedLoras.length > 0) {
        input.loras = selectedLoras
      }
      input.image_base64 = imagePayload

      const res = await fetchWithAuth(selectedVideoModel.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input }),
      })
      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        const rawMessage = data?.error || data?.message || data?.detail || '生成に失敗しました。'
        const message = normalizeErrorMessage(rawMessage)
        if (isTicketShortage(res.status, message)) {
          setShowTicketModal(true)
          setStatusMessage('クレジットが不足しています。')
          throw new Error('TICKET_SHORTAGE')
        }
        setErrorModalMessage(message)
        throw new Error(message)
      }

      const nextTickets = Number(data?.ticketsLeft ?? data?.tickets_left)
      if (Number.isFinite(nextTickets)) {
        setTicketCount(nextTickets)
      }

      const videos = extractVideoList(data)
      if (videos.length) {
        return { videos }
      }

      const jobId = extractJobId(data)
      if (!jobId) throw new Error('ジョブIDを取得できませんでした。')
      return { jobId }
    },
    [
      height,
      negativePrompt,
      selectedVideoLength,
      selectedVideoModel,
      selectedLoras,
      sourceName,
      videoPromptForGeneration,
      width,
    ],
  )

  const pollJob = useCallback(async (jobId: string, runId: number): Promise<PollVideoResult> => {
    let statusCheckFailures = 0
    for (let i = 0; i < 180; i += 1) {
      if (runIdRef.current !== runId) return { status: 'cancelled' as const, videos: [] }

      const params = new URLSearchParams({
        id: jobId,
        mode: 'i2v',
        seconds: String(selectedVideoLength.seconds),
      })
      let res: Response
      let data: any = {}
      try {
        res = await fetchWithAuth(`${selectedVideoModel.endpoint}?${params.toString()}`)
        data = await res.json().catch(() => ({}))
      } catch {
        statusCheckFailures += 1
        if (statusCheckFailures < 30) {
          setStatusMessage('ステータス確認を再試行中です…')
          await wait(2500 + i * 50)
          continue
        }
        throw new Error('ステータス確認に失敗しました。')
      }

      if (!res.ok) {
        const rawMessage = data?.error || data?.message || data?.detail || 'ステータス確認に失敗しました。'
        const message = normalizeErrorMessage(rawMessage)
        if (isTicketShortage(res.status, message)) {
          setShowTicketModal(true)
          setStatusMessage('クレジットが不足しています。')
          throw new Error('TICKET_SHORTAGE')
        }
        if (isRetryableStatusCheck(res.status) && statusCheckFailures < 30) {
          statusCheckFailures += 1
          setStatusMessage('ステータス確認を再試行中です…')
          await wait(2500 + i * 50)
          continue
        }
        setErrorModalMessage(message)
        throw new Error(message)
      }
      statusCheckFailures = 0

      const nextTickets = Number(data?.ticketsLeft ?? data?.tickets_left)
      if (Number.isFinite(nextTickets)) {
        setTicketCount(nextTickets)
      }

      const status = String(data?.status || data?.state || '').toLowerCase()
      const statusError = extractErrorMessage(data)
      if (statusError || isFailureStatus(status)) {
        throw new Error(normalizeErrorMessage(statusError || '生成に失敗しました。'))
      }

      const videos = extractVideoList(data)
      if (videos.length) {
        return { status: 'done' as const, videos }
      }

      await wait(2000 + i * 50)
    }

    throw new Error('生成がタイムアウトしました。')
  }, [selectedVideoLength.seconds, selectedVideoModel])

  const runMMAudioPipeline = useCallback(async (
    videoSource: string,
    fxPrompt: string,
    runId: number,
    pipelineUsageId?: string,
    duration?: number,
  ) => {
    const videoBase64 = await sourceToBase64(videoSource)
    const videoExt = inferVideoExt(videoSource)
    const res = await fetchWithAuth('/api/mmaudio', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: {
            text: fxPrompt,
            video_base64: videoBase64,
            video_ext: videoExt,
            duration,
            pipeline_usage_id: pipelineUsageId || undefined,
          },
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      const message = normalizeErrorMessage(extractErrorMessage(data) || 'sound付き動画の生成開始に失敗しました。')
      if (isTicketShortage(res.status, message)) {
        setShowTicketModal(true)
        setStatusMessage('クレジットが不足しています。')
        throw new Error('TICKET_SHORTAGE')
      }
      throw new Error(message)
    }

    const immediateVideo = extractVideo(data)
    if (immediateVideo) return immediateVideo

    const jobId = extractJobId(data)
    if (!jobId) {
      throw new Error('sound付き動画のジョブIDを取得できませんでした。')
    }

    let statusCheckFailures = 0
    for (let i = 0; i < 180; i += 1) {
      if (runIdRef.current !== runId) return null
      let pollRes: Response
      let pollData: any = {}
      try {
        pollRes = await fetchWithAuth(`/api/mmaudio?id=${encodeURIComponent(String(jobId))}${pipelineUsageId ? `&pipeline_usage_id=${encodeURIComponent(pipelineUsageId)}` : ``}`)
        pollData = await pollRes.json().catch(() => ({}))
      } catch {
        statusCheckFailures += 1
        if (statusCheckFailures < 30) {
          setStatusMessage('soundの状態確認を再試行中です…')
          await wait(2500 + i * 50)
          continue
        }
        throw new Error('sound付き動画の状態確認に失敗しました。')
      }
      if (!pollRes.ok) {
        const message = normalizeErrorMessage(extractErrorMessage(pollData) || 'sound付き動画の状態確認に失敗しました。')
        if (isTicketShortage(pollRes.status, message)) {
          setShowTicketModal(true)
          setStatusMessage('クレジットが不足しています。')
          throw new Error('TICKET_SHORTAGE')
        }
        if (isRetryableStatusCheck(pollRes.status) && statusCheckFailures < 30) {
          statusCheckFailures += 1
          setStatusMessage('soundの状態確認を再試行中です…')
          await wait(2500 + i * 50)
          continue
        }
        throw new Error(message)
      }
      statusCheckFailures = 0

      const maybeVideo = extractVideo(pollData)
      if (maybeVideo) return maybeVideo

      const status = String(pollData?.status || pollData?.state || '').toUpperCase()
      if (isFailureStatus(status)) {
        throw new Error(normalizeErrorMessage(extractErrorMessage(pollData) || `sound付き動画の生成に失敗しました: ${status}`))
      }
      await wait(2500)
    }

    throw new Error('sound付き動画の生成がタイムアウトしました。')
  }, [])

  const runMMAudioMuxPipeline = useCallback(
    async (baseVideoSource: string, audioVideoSource: string, pipelineUsageId: string) => {
      const baseVideoBase64 = await sourceToBase64(baseVideoSource)
      const audioVideoBase64 = await sourceToBase64(audioVideoSource)
      const baseVideoExt = inferVideoExt(baseVideoSource)
      const audioVideoExt = inferVideoExt(audioVideoSource)

      const res = await fetchWithAuth('/api/mmaudio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: {
            mux_only: true,
            pipeline_usage_id: pipelineUsageId,
            base_video_base64: baseVideoBase64,
            base_video_ext: baseVideoExt,
            audio_video_base64: audioVideoBase64,
            audio_video_ext: audioVideoExt,
          },
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(normalizeErrorMessage(extractErrorMessage(data) || '動画とsoundの保存用結合に失敗しました。'))
      }

      const muxedVideo = extractVideo(data)
      if (!muxedVideo) {
        throw new Error('動画とsoundの結合結果を取得できませんでした。')
      }
      return muxedVideo
    },
    [],
  )

  const mixVideoWithAudioTracks = useCallback(
    async (
      videoSource: string,
      runId: number,
      options?: {
        fxAudioVideoSource?: string | null
        targetSeconds?: number
      },
    ) => {
      const fxAudioVideoSource = options?.fxAudioVideoSource ?? null
      const targetSeconds = options?.targetSeconds
      const videoDataUrl = await sourceToDataUrl(videoSource)
      const fxAudioVideoDataUrl =
        fxAudioVideoSource && fxAudioVideoSource !== videoSource ? await sourceToDataUrl(fxAudioVideoSource) : null
      if (runIdRef.current !== runId) return null

      const videoEl = document.createElement('video')
      videoEl.preload = 'auto'
      videoEl.muted = true
      videoEl.playsInline = true

      const fxAudioEl = fxAudioVideoDataUrl ? document.createElement('video') : null
      if (fxAudioEl) {
        fxAudioEl.preload = 'auto'
        fxAudioEl.muted = false
        fxAudioEl.playsInline = true
      }

      let sourceStream: MediaStream | null = null
      let mixedStream: MediaStream | null = null
      let audioContext: AudioContext | null = null
      let recorder: MediaRecorder | null = null
      let rafId = 0

      try {
        const metadataTasks: Promise<void>[] = [
          waitForVideoMetadata(videoEl, videoDataUrl, '動画メタデータの読み込みに失敗しました。'),
        ]
        if (fxAudioEl && fxAudioVideoDataUrl) {
          metadataTasks.push(
            waitForVideoMetadata(fxAudioEl, fxAudioVideoDataUrl, 'sound動画メタデータの読み込みに失敗しました。'),
          )
        }
        await withTimeout(
          Promise.all(metadataTasks),
          20_000,
          '動画メタデータの取得がタイムアウトしました。ブラウザを再読み込みして再試行してください。',
        )

        const sourceWidth = Math.max(2, Math.floor(videoEl.videoWidth || 0))
        const sourceHeight = Math.max(2, Math.floor(videoEl.videoHeight || 0))
        if (!sourceWidth || !sourceHeight) {
          throw new Error('動画サイズを取得できませんでした。')
        }

        const mixCanvas = document.createElement('canvas')
        mixCanvas.width = sourceWidth
        mixCanvas.height = sourceHeight
        const mixCtx = mixCanvas.getContext('2d')
        if (!mixCtx) {
          throw new Error('最終合成用のキャンバスを初期化できませんでした。')
        }

        const capturableCanvas = mixCanvas as CapturableCanvasElement
        const capturableVideoEl = videoEl as CapturableVideoElement
        sourceStream =
          (typeof capturableCanvas.captureStream === 'function'
            ? capturableCanvas.captureStream(FIXED_FPS)
            : captureVideoElementStream(capturableVideoEl, FIXED_FPS))
        if (!sourceStream) {
          throw new Error('このブラウザは最終合成に対応していません。')
        }
        const videoTrack = sourceStream.getVideoTracks()[0]
        if (!videoTrack) {
          throw new Error('動画トラックを取得できませんでした。')
        }

        const renderFrame = () => {
          if (videoEl.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
            mixCtx.drawImage(videoEl, 0, 0, sourceWidth, sourceHeight)
          }
          rafId = window.requestAnimationFrame(renderFrame)
        }
        renderFrame()

        audioContext = new AudioContext()
        const destination = audioContext.createMediaStreamDestination()
        const videoSourceNode = audioContext.createMediaElementSource(videoEl)
        const videoGain = audioContext.createGain()
        videoGain.gain.value = fxAudioEl ? 0 : 1
        videoSourceNode.connect(videoGain).connect(destination)
        if (fxAudioEl) {
          const fxSourceNode = audioContext.createMediaElementSource(fxAudioEl)
          const fxGain = audioContext.createGain()
          fxGain.gain.value = 1
          fxSourceNode.connect(fxGain).connect(destination)
        }
        if (audioContext.state === 'suspended') {
          void audioContext.resume().catch(() => undefined)
        }

        mixedStream = new MediaStream()
        mixedStream.addTrack(videoTrack)
        const mixedAudioTrack = destination.stream.getAudioTracks()[0]
        if (mixedAudioTrack) {
          mixedStream.addTrack(mixedAudioTrack)
        }

        const mimeType = MIX_EXPORT_MIME_CANDIDATES.find((item) => MediaRecorder.isTypeSupported(item)) ?? 'video/webm'
        recorder = new MediaRecorder(mixedStream, { mimeType, videoBitsPerSecond: 8_000_000 })
        const chunks: BlobPart[] = []

        const stopPromise = new Promise<void>((resolve, reject) => {
          recorder!.ondataavailable = (event) => {
            if (event.data.size > 0) chunks.push(event.data)
          }
          recorder!.onstop = () => resolve()
          recorder!.onerror = () => reject(new Error('最終動画の録画に失敗しました。'))
        })

        videoEl.currentTime = 0
        if (fxAudioEl) fxAudioEl.currentTime = 0
        recorder.start(1000)
        await withTimeout(startMediaElementPlayback(videoEl), 3_000, '動画再生の開始に失敗しました。')
        if (fxAudioEl) {
          await withTimeout(startMediaElementPlayback(fxAudioEl), 3_000, 'sound再生の開始に失敗しました。')
        }

        const requestedDurationMs =
          typeof targetSeconds === 'number' && Number.isFinite(targetSeconds) && targetSeconds > 0
            ? Math.floor(targetSeconds * 1000)
            : null
        const naturalDurationMs = Number.isFinite(videoEl.duration) ? Math.floor(videoEl.duration * 1000) : null
        const stopAfterMs = Math.max(1000, requestedDurationMs ?? naturalDurationMs ?? 15_000)

        await withTimeout(
          new Promise<void>((resolve) => {
            const timer = window.setTimeout(resolve, stopAfterMs)
            videoEl.onended = () => {
              window.clearTimeout(timer)
              resolve()
            }
          }),
          stopAfterMs + 2_500,
          '最終合成の再生待機がタイムアウトしました。',
        )

        if (recorder.state !== 'inactive') recorder.stop()
        await withTimeout(stopPromise, 6_000, '最終動画の録画停止がタイムアウトしました。')

        const mixedBlob = new Blob(chunks, { type: mimeType })
        if (mixedBlob.size === 0) {
          throw new Error('最終動画のデータが空でした。')
        }
        return URL.createObjectURL(mixedBlob)
      } finally {
        if (rafId) window.cancelAnimationFrame(rafId)
        videoEl.pause()
        if (fxAudioEl) fxAudioEl.pause()
        videoEl.removeAttribute('src')
        videoEl.load()
        if (fxAudioEl) {
          fxAudioEl.removeAttribute('src')
          fxAudioEl.load()
        }
        if (recorder && recorder.state !== 'inactive') {
          try {
            recorder.stop()
          } catch {
            // no-op
          }
        }
        sourceStream?.getTracks().forEach((track: MediaStreamTrack) => track.stop())
        mixedStream?.getTracks().forEach((track: MediaStreamTrack) => track.stop())
        if (audioContext) {
          await audioContext.close().catch(() => undefined)
        }
      }
    },
    [],
  )

  const startGeneration = useCallback(
    async (imagePayload: string) => {
      if (!imagePayload) return
      if (!session) {
        setStatusMessage('先にGoogleログインしてください。')
        return
      }

      const runId = runIdRef.current + 1
      runIdRef.current = runId
      setIsRunning(true)
      setStatusMessage('動画を生成中です…')
      setDisplayVideo(null)
      setDisplayAudioVideo(null)
      setDisplayPipelineUsageId(null)
      let fallbackVideo: string | null = null

      try {
        const trimmedSfx = isSfxEnabled ? soundPromptForGeneration : ''
        const shouldRunSfx = trimmedSfx.length > 0
        const pipelineUsageId = shouldRunSfx ? makePipelineUsageId() : ''
        let baseVideo: string | null = null
        const submitted = await submitVideo(imagePayload)
        if (runIdRef.current !== runId) return

        if ('videos' in submitted && Array.isArray(submitted.videos) && submitted.videos.length) {
          baseVideo = submitted.videos[0]
        } else if ('jobId' in submitted && typeof submitted.jobId === 'string' && submitted.jobId) {
          const polled = await pollJob(submitted.jobId, runId)
          if (runIdRef.current !== runId) return
          if (polled.status === 'done' && polled.videos.length) {
            baseVideo = polled.videos[0]
          }
        }

        if (!baseVideo) {
          throw new Error('動画生成結果を取得できませんでした。')
        }
        fallbackVideo = baseVideo

        if (!shouldRunSfx) {
          setDisplayVideo(baseVideo)
          setDisplayAudioVideo(null)
          setDisplayPipelineUsageId(null)
          setStatusMessage('動画生成が完了しました。')
          if (accessToken) {
            await fetchTickets()
          }
          return
        }

        if (shouldRunSfx) {
          setStatusMessage('sound付き動画を生成中です…')
          const fxVideo = await runMMAudioPipeline(baseVideo, trimmedSfx, runId, pipelineUsageId, selectedVideoLength.seconds)
          if (!fxVideo || runIdRef.current !== runId) return
          setDisplayVideo(fxVideo)
          setDisplayAudioVideo(null)
          setDisplayPipelineUsageId(null)
          fallbackVideo = fxVideo
          setStatusMessage('動画生成が完了しました。')
          if (accessToken) {
            await fetchTickets()
          }
          return
        }

        setDisplayVideo(baseVideo)
        setStatusMessage('動画生成が完了しました。')

        if (accessToken) {
          await fetchTickets()
        }
      } catch (error) {
        if (runIdRef.current !== runId) return
        const message = normalizeErrorMessage(error instanceof Error ? error.message : error)
        if (message !== 'TICKET_SHORTAGE') {
          if (fallbackVideo) {
            setDisplayVideo(fallbackVideo)
            setStatusMessage(`一部処理でエラーが発生したため、途中結果を表示しています。${message}`)
          } else {
            setStatusMessage(message)
          }
        }
      } finally {
        if (runIdRef.current === runId) {
          setIsRunning(false)
        }
      }
    },
    [
      accessToken,
      fetchTickets,
      pollJob,
      runMMAudioPipeline,
      isSfxEnabled,
      session,
      submitVideo,
      selectedVideoLength.seconds,
      soundPromptForGeneration,
      videoPromptForGeneration,
    ],
  )

  const clearImage = useCallback(() => {
    setSourcePreview(null)
    setSourcePayload(null)
    setSourceName('')
    setDisplayVideo(null)
    setDisplayAudioVideo(null)
    setDisplayPipelineUsageId(null)
    setStatusMessage('')
  }, [])

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = String(reader.result || '')
      const img = new Image()
      img.onload = () => {
        const { width: targetWidth, height: targetHeight } = getTargetSize(img.naturalWidth, img.naturalHeight)
        const paddedDataUrl = buildPaddedDataUrl(img, targetWidth, targetHeight) ?? dataUrl
        setWidth(targetWidth)
        setHeight(targetHeight)
        setSourcePreview(paddedDataUrl)
        setSourcePayload(toBase64(paddedDataUrl))
        setSourceName(file.name)
        setStatusMessage(session ? '画像を読み込みました。プロンプトまたはLoRAを設定して生成できます。' : '先にGoogleログインしてください。')
      }
      img.src = dataUrl
    }
    reader.readAsDataURL(file)
  }

  const handleGenerate = async () => {
    if (!sourcePayload || isRunning) return
    if (!session) {
      setStatusMessage('先にGoogleログインしてください。')
      return
    }
    if (!videoPromptForGeneration.trim()) {
      setStatusMessage('プロンプトを入力するかLoRAを0.1以上にしてください。')
      return
    }
    if (isSfxEnabled && !soundPromptForGeneration) {
      setStatusMessage('soundプロンプトを入力してください。')
      return
    }

    if (ticketStatus === 'loading') {
      setStatusMessage('クレジットを確認中...')
      return
    }

    if (accessToken) {
      setStatusMessage('クレジットを確認中...')
      const latestCount = await fetchTickets()
      if (latestCount !== null && latestCount < requiredPointsForRun) {
        setShowTicketModal(true)
        return
      }
    } else if (ticketCount === null) {
      setStatusMessage('クレジットを確認中...')
      return
    } else if (ticketCount < requiredPointsForRun) {
      setShowTicketModal(true)
      return
    }
    await startGeneration(sourcePayload)
  }

  const handleSaveResult = useCallback(async () => {
    if (!displayVideo || isSavingResult) return
    setIsSavingResult(true)
    let temporarySource: string | null = null
    try {
      let sourceToSave = displayVideo
      if (displayAudioVideo) {
        if (!displayPipelineUsageId) {
          throw new Error('sound付き動画のMP4保存情報が見つかりません。再生成してから保存してください。')
        }
        setStatusMessage('sound付き動画をMP4保存用に結合中です…')
        sourceToSave = await runMMAudioMuxPipeline(displayVideo, displayAudioVideo, displayPipelineUsageId)
      }

      if (!sourceToSave) return
      temporarySource = displayAudioVideo && sourceToSave.startsWith('blob:') ? sourceToSave : null

      await saveGeneratedAsset({
        source: sourceToSave,
        filenamePrefix: 'orcaai-video',
        fallbackExtension: isGif ? 'gif' : 'mp4',
      })
      setStatusMessage(displayAudioVideo ? 'sound付き動画をMP4で保存しました。' : '動画を保存しました。')
    } catch (error) {
      setStatusMessage(normalizeErrorMessage(error instanceof Error ? error.message : error))
    } finally {
      if (temporarySource) {
        URL.revokeObjectURL(temporarySource)
      }
      setIsSavingResult(false)
    }
  }, [
    displayAudioVideo,
    displayPipelineUsageId,
    displayVideo,
    isGif,
    isSavingResult,
    mixVideoWithAudioTracks,
    runMMAudioMuxPipeline,
    selectedVideoLength.seconds,
  ])

  if (!authReady) {
    return (
      <div className="studio-page">
        <TopNav />
        <div className="studio-loader">読み込み中...</div>
      </div>
    )
  }

  const canClaimDailyBonus = Boolean(session && dailyBonusStatus === 'ready' && !isClaimingDailyBonus && !isRunning)
  const dailyBonusButtonLabel =
    isClaimingDailyBonus || dailyBonusStatus === 'loading'
      ? '確認中'
      : dailyBonusStatus === 'ready'
        ? 'ボーナス受け取り'
        : 'ボーナス待機中'

  return (
    <div className="studio-page">
      <TopNav />
      <main className="studio-wrap">
        <section className="studio-panel studio-panel--controls">
          <header className="studio-heading">
            <h1>Orca Video Studio</h1>
            <p>画像を1枚選び、動きと音の指示を入力して動画を生成します。</p>
          </header>

          <div className="studio-ticket-row">
            <span className="studio-ticket-label">保有クレジット</span>
            <strong className="studio-ticket-value">{session ? (ticketStatus === 'loading' ? '確認中' : ticketCount ?? 0) : '--'}</strong>
            {session && (
              <span className={`studio-premium-badge${isPremiumMember ? ' is-premium' : ''}`}>
                {isPremiumMember ? 'Premium 有効' : '通常プラン'}
              </span>
            )}
            <span className="studio-ticket-cost">
              {`必要 ${requiredPoints} / ${selectedVideoLength.seconds}秒${audioPipelineCost > 0 ? ' + sound' : ''}`}
            </span>
            {session && (
              <div className="studio-ticket-actions">
                <button
                  type="button"
                  className="studio-mini-button studio-mini-button--primary"
                  onClick={handleClaimDailyBonus}
                  disabled={!canClaimDailyBonus}
                >
                  {dailyBonusButtonLabel}
                </button>
                <button type="button" className="studio-mini-button" onClick={handleSignOut} disabled={isRunning}>
                  ログアウト
                </button>
              </div>
            )}
          </div>

          {ticketStatus === 'error' && ticketMessage && <p className="studio-inline-error">{ticketMessage}</p>}
          {session && dailyBonusMessage && (
            <p className={`studio-inline-note${dailyBonusStatus === 'error' ? ' studio-inline-note--error' : ''}`}>
              {dailyBonusMessage}
            </p>
          )}

          {session ? (
            <div className="studio-form-stack">
              <label className="studio-upload">
                <input type="file" accept="image/*" onChange={handleFileChange} />
                <div className="studio-upload-inner">
                  <strong>{sourceName || '素材画像を選択'}</strong>
                  <span>JPG / PNG / WebPに対応</span>
                </div>
              </label>

              {sourcePreview && (
                <div className="studio-thumb-wrap">
                  <img src={sourcePreview} alt="選択画像" className="studio-thumb" />
                  <button type="button" className="studio-thumb-remove" onClick={clearImage} aria-label="画像を削除">
                    削除
                  </button>
                </div>
              )}

              <label className="studio-field">
                <span>動きの指示</span>
                <textarea
                  rows={4}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="女性が男性とキスする。"
                />
              </label>

              <label className="studio-field">
                <span>避けたい要素</span>
                <textarea
                  rows={3}
                  value={negativePrompt}
                  onChange={(e) => setNegativePrompt(e.target.value)}
                  placeholder="例: blur, distortion, extra fingers, text, watermark"
                />
              </label>

              <div className="studio-lora-panel">
                <div className="studio-lora-head">
                  <span>LoRA</span>
                  <strong>{selectedLoras.length ? `${selectedLoras.length}件選択中` : '未選択'}</strong>
                </div>
                <div className="studio-lora-list">
                  {LORA_OPTIONS.map((option) => {
                    const strength = Number(loraStrengths[option.id] ?? DEFAULT_LORA_STRENGTH)
                    const isLocked = !isPremiumMember && isPremiumLoraOption(option.id)
                    const displayedStrength = isLocked ? DEFAULT_LORA_STRENGTH : strength
                    const isSelected = displayedStrength >= ACTIVE_LORA_STRENGTH
                    return (
                      <div
                        key={option.id}
                        className={`studio-lora-option${isSelected ? ' is-active' : ''}${isLocked ? ' is-locked' : ''}`}
                      >
                        <div className="studio-lora-check">
                          <span>
                            <strong>{option.label}</strong>
                            {isPremiumLoraOption(option.id) ? <small>Premium限定</small> : null}
                          </span>
                        </div>
                        <div className="studio-lora-strength">
                          <input
                            type="range"
                            min={MIN_LORA_STRENGTH}
                            max={MAX_LORA_STRENGTH}
                            step="0.1"
                            value={displayedStrength}
                            onChange={(event) => updateLoraStrength(option.id, Number(event.target.value))}
                            disabled={isRunning || isLocked}
                            aria-label={`${option.label}の強さ`}
                          />
                          <output>{displayedStrength.toFixed(1)}</output>
                        </div>
                      </div>
                    )
                  })}
                </div>
                <p className="studio-field-note">
                  必要な動きだけ選択できます。Lora選択時はプロンプトなしでも生成できます。複数選択時は効果が重なります。まずはLoraを1種類と顔写真をアップしてプロンプトなしでお試しください。1.0から1.5がおすすめです。Premium限定LoRAはメンバーのみ利用できます。
                </p>
              </div>

              <div className="studio-lora-panel" aria-label="sound">
                <div className="studio-lora-head">
                  <span>sound</span>
                  <strong>{isSfxEnabled ? 'オン' : 'オフ'}</strong>
                </div>
                <div className="studio-toggle-row">
                  <span>soundを追加 (+1クレジット)</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={isSfxEnabled}
                    aria-label="soundを切り替え"
                    className={`studio-switch${isSfxEnabled ? ' is-on' : ''}`}
                    onClick={() => setIsSfxEnabled((value) => !value)}
                    disabled={isRunning}
                  >
                    <span className="studio-switch-thumb" aria-hidden="true" />
                  </button>
                </div>
                <label className={`studio-field${isSfxEnabled ? '' : ' is-disabled'}`}>
                  <span>soundの指示</span>
                  <textarea
                    rows={3}
                    value={sfxPrompt}
                    onChange={(e) => setSfxPrompt(e.target.value)}
                    placeholder="女性が喘ぎ声を出す、キス音"
                    disabled={isRunning || !isSfxEnabled}
                  />
                </label>
                <p className="studio-field-note">オンにするとsoundプロンプトを使用し、追加で1クレジット消費します。</p>
              </div>

              <div className="studio-duration-row">
                <span>動画の長さ</span>
                <div className="studio-duration-options" role="radiogroup" aria-label="動画の長さ">
                  {VIDEO_LENGTH_OPTIONS.map((option) => (
                    <button
                      key={option.seconds}
                      type="button"
                      role="radio"
                      aria-checked={videoLengthSeconds === option.seconds}
                      className={`studio-duration-option${videoLengthSeconds === option.seconds ? ' is-active' : ''}`}
                      onClick={() => setVideoLengthSeconds(option.seconds)}
                      disabled={isRunning}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="studio-generate-dock studio-generate-dock--single">
                <button type="button" className="studio-btn studio-btn--primary" onClick={handleGenerate} disabled={!canGenerate}>
                  {isRunning ? '生成中...' : '生成する'}
                </button>
                <p className="studio-field-note">
                  {isSfxEnabled
                    ? 'soundあり: soundプロンプトを使用し、追加で1クレジット消費します。'
                    : 'soundオフ: 動画のみ生成します。'}
                </p>
              </div>
            </div>
          ) : (
            <div className="studio-login-cta studio-login-cta--panel">
              <p>Googleログイン後に動画生成を利用できます。</p>
              <button type="button" className="studio-btn studio-btn--primary" onClick={handleGoogleSignIn}>
                Googleでログイン
              </button>
              {!isAuthConfigured && <p className="studio-field-note">認証設定が未完了です。</p>}
            </div>
          )}

          {statusMessage && <p className="studio-status">{statusMessage}</p>}
        </section>

        <section className="studio-panel studio-panel--preview">
          <div className="studio-preview-head">
            <h2>生成結果</h2>
            <span>{isRunning ? '生成中' : displayVideo ? '完了' : '待機中'}</span>
          </div>

          <div className="studio-canvas" style={viewerStyle}>
            {isRunning ? (
              <div className="studio-loading studio-loading--video" role="status" aria-live="polite">
                <div className="studio-loading-cube-scene" aria-hidden="true">
                  <div className="studio-loading-cube">
                    <span className="studio-loading-cube__face studio-loading-cube__face--front" />
                    <span className="studio-loading-cube__face studio-loading-cube__face--back" />
                    <span className="studio-loading-cube__face studio-loading-cube__face--right" />
                    <span className="studio-loading-cube__face studio-loading-cube__face--left" />
                    <span className="studio-loading-cube__face studio-loading-cube__face--top" />
                    <span className="studio-loading-cube__face studio-loading-cube__face--bottom" />
                  </div>
                  <span className="studio-loading-cube-orbit studio-loading-cube-orbit--one" />
                  <span className="studio-loading-cube-orbit studio-loading-cube-orbit--two" />
                </div>
                <p className="studio-loading__title">生成中</p>
                <p className="studio-loading__subtitle">{loadingSubtitle}</p>
              </div>
            ) : displayVideo ? (
              <div className="studio-result-media">
                <button
                  type="button"
                  className="studio-save-btn"
                  onClick={handleSaveResult}
                  disabled={isSavingResult}
                >
                  {isSavingResult ? '保存中' : '保存'}
                </button>
                {isGif ? (
                  <img src={displayVideo} alt="生成動画" />
                ) : displayAudioVideo ? (
                  <SyncedVideoPlayer videoSrc={displayVideo} audioSrc={displayAudioVideo} />
                ) : (
                  <video controls controlsList="nodownload" src={displayVideo} />
                )}
              </div>
            ) : (
              <div className="studio-preview-idle">
                <p>生成後の動画がここに表示されます。</p>
                {!sourcePayload && session && <p>先に素材画像を選択してください。</p>}
              </div>
            )}
          </div>
          {statusMessage && <p className="studio-status studio-status--preview">{statusMessage}</p>}
        </section>

      </main>

      {showTicketModal && (
        <div className="studio-modal-overlay" role="dialog" aria-modal="true">
          <div className="studio-modal-card">
            <h3>クレジット不足</h3>
            <p>{`この設定では${requiredPointsForRun}クレジットが必要です。購入ページで追加してください。`}</p>
            <div className="studio-modal-actions">
              <button type="button" className="studio-btn studio-btn--ghost" onClick={() => setShowTicketModal(false)}>
                閉じる
              </button>
              <button
                type="button"
                className="studio-btn studio-btn--primary"
                onClick={() => window.open(GET_CREDIT_PURCHASE_URL, '_blank', 'noopener,noreferrer')}
              >
                購入ページへ
              </button>
            </div>
          </div>
        </div>
      )}

      {errorModalMessage && (
        <div className="studio-modal-overlay" role="dialog" aria-modal="true">
          <div className="studio-modal-card">
            <h3>エラー</h3>
            <p>{errorModalMessage}</p>
            <div className="studio-modal-actions">
              <button type="button" className="studio-btn studio-btn--primary" onClick={() => setErrorModalMessage(null)}>
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}





