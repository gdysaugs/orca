import workflowI2VTemplate from '../api/wan-workflow-i2v.json'
import workflowDasiwaI2VTemplate from '../api/wan-dasiwa-workflow-i2v.json'
import workflowAnimateTemplate from '../api/wan-workflow-animate.json'
import nodeMapI2VTemplate from '../api/wan-node-map-i2v.json'
import nodeMapAnimateTemplate from '../api/wan-node-map-animate.json'
import { createClient, type User } from '@supabase/supabase-js'
import { getSupabaseUserWithRetry } from './auth-retry'
import { buildCorsHeaders, isCorsBlocked } from './cors'
import { hasActivePremiumMembership } from './premium'
import { isUnderageImage } from './rekognition'

type Env = {
  RUNPOD_API_KEY: string
  RUNPOD_WAN_RAPID_FASTMOVE_ENDPOINT_URL?: string
  RUNPOD_WAN_DASIWA_ENDPOINT_URL?: string
  RUNPOD_WAN_LORA_PACK_ENDPOINT_URL?: string
  RUNPOD_ENDPOINT_URL?: string
  RUNPOD_WAN_ENDPOINT_URL?: string
  COMFY_ORG_API_KEY?: string
  AWS_ACCESS_KEY_ID?: string
  AWS_SECRET_ACCESS_KEY?: string
  AWS_REGION?: string
  SUPABASE_URL?: string
  SUPABASE_SERVICE_ROLE_KEY?: string
}

const corsMethods = 'POST, GET, OPTIONS'

const jsonResponse = (body: unknown, status = 200, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  })

const DEFAULT_LORA_PACK_ENDPOINT = 'https://api.runpod.ai/v2/rywgsws0odibjj'
const DEFAULT_LORA_PACK_STRENGTH = 0
const MIN_LORA_PACK_STRENGTH = 0
const ACTIVE_LORA_PACK_STRENGTH = 0.1
const MAX_LORA_PACK_STRENGTH = 1.5
const MAX_LORA_PACK_SELECTIONS = 40

const LORA_PACK_OPTIONS = {
  low_e9ab98e68aace885: {
    high: [],
    low: ['lowE9AB98E68AACE885.E9ax.safetensors'],
  },
  e68a93e4bd8fe8b7aa: {
    high: ['highE68A93E4BD8FE8B7AA.TQSA.safetensors'],
    low: ['lowE68A93E4BD8FE8B7AA.XnYy.safetensors'],
  },
  e78ebbe79283: {
    high: ['E78EBBE79283High.ffNp.safetensors'],
    low: [],
  },
  facedownassup: {
    high: ['WAN-2.2-I2V-FaceDownAssUp-HIGH-v1.safetensors'],
    low: ['WAN-2.2-I2V-FaceDownAssUp-LOW-v1.safetensors'],
  },
  e6b7b9e6b2a1: {
    high: ['E6B7B9E6B2A1High.oNPH.safetensors'],
    low: [],
  },
  e68993e884b890e9ab98: {
    high: ['E68993E884B890E9AB98.uiDs.safetensors'],
    low: [],
  },
  frenchkiss: {
    high: ['WAN2.2-FrenchKiss_HighNoise.safetensors'],
    low: ['WAN2.2-FrenchKiss_LowNoise.safetensors'],
  },
  reverse_suspended_congress: {
    high: ['reverse_suspended_congress_I2V_high.safetensors'],
    low: ['reverse_suspended_congress_I2V_low.safetensors'],
  },
  handjob_blowjob_combo: {
    high: ['WAN-2.2-I2V-HandjobBlowjobCombo-HIGH-v1.safetensors'],
    low: ['WAN-2.2-I2V-HandjobBlowjobCombo-LOW-v1.safetensors'],
  },
  pov_titfuck_paizuri: {
    high: ['WAN-2.2-I2V-POV-Titfuck-Paizuri-HIGH-v1.0.safetensors'],
    low: ['WAN-2.2-I2V-POV-Titfuck-Paizuri-LOW-v1.0.safetensors'],
  },
  cumshot_aesthetics: {
    high: ['23High noise-Cumshot Aesthetics.safetensors'],
    low: ['56Low noise-Cumshot Aesthetics.safetensors'],
  },
  cumshot_aesthetics_1: {
    high: ['23High noise-Cumshot Aesthetics.safetensors'],
    low: ['56Low noise-Cumshot Aesthetics.safetensors'],
  },
  cumshot_aesthetics_2: {
    high: ['23High noise-Cumshot Aesthetics.safetensors'],
    low: ['56Low noise-Cumshot Aesthetics.safetensors'],
  },
  cumshot_aesthetics_3: {
    high: ['23High noise-Cumshot Aesthetics.safetensors'],
    low: ['56Low noise-Cumshot Aesthetics.safetensors'],
  },
  cumshot_aesthetics_4: {
    high: ['23High noise-Cumshot Aesthetics.safetensors'],
    low: ['56Low noise-Cumshot Aesthetics.safetensors'],
  },
  pov_missionary: {
    high: ['wan2.2_i2v_highnoise_pov_missionary_v1.0.safetensors'],
    low: ['wan2.2_i2v_lownoise_pov_missionary_v1.0.safetensors'],
  },
  i2pee: {
    high: ['WAN2.2-I2V_HighNoise_I2Pee-V4.safetensors'],
    low: ['WAN2.2-I2V_LowNoise_I2Pee-V4.safetensors'],
  },
  tithandjob: {
    high: [],
    low: ['iGoon_Blink_Titjob_I2V_LOW.safetensors'],
  },
  blink_titjob_1: {
    high: [],
    low: ['iGoon_Blink_Titjob_I2V_LOW.safetensors'],
  },
  blink_titjob_2: {
    high: [],
    low: ['iGoon_Blink_Titjob_I2V_LOW.safetensors'],
  },
  blink_back_doggystyle: {
    high: ['iGoon - Blink_Back_Doggystyle_HIGH.safetensors'],
    low: ['iGoon - Blink_Back_Doggystyle_LOW.safetensors'],
  },
  blink_back_doggystyle_1: {
    high: ['iGoon - Blink_Back_Doggystyle_HIGH.safetensors'],
    low: ['iGoon - Blink_Back_Doggystyle_LOW.safetensors'],
  },
  blink_back_doggystyle_2: {
    high: ['iGoon - Blink_Back_Doggystyle_HIGH.safetensors'],
    low: ['iGoon - Blink_Back_Doggystyle_LOW.safetensors'],
  },
  blink_facial: {
    high: ['iGoon%20-%20Blink_Facial_I2V_HIGH.safetensors'],
    low: ['iGoon%20-%20Blink_Facial_I2V_LOW.safetensors'],
  },
  blink_facial_1: {
    high: ['iGoon%20-%20Blink_Facial_I2V_HIGH.safetensors'],
    low: ['iGoon%20-%20Blink_Facial_I2V_LOW.safetensors'],
  },
  blink_facial_2: {
    high: ['iGoon%20-%20Blink_Facial_I2V_HIGH.safetensors'],
    low: ['iGoon%20-%20Blink_Facial_I2V_LOW.safetensors'],
  },
  blink_front_doggystyle: {
    high: ['iGoon%20-%20Blink_Front_Doggystyle_I2V_HIGH.safetensors'],
    low: ['iGoon%20-%20Blink_Front_Doggystyle_I2V_LOW.safetensors'],
  },
  blink_front_doggystyle_1: {
    high: ['iGoon%20-%20Blink_Front_Doggystyle_I2V_HIGH.safetensors'],
    low: ['iGoon%20-%20Blink_Front_Doggystyle_I2V_LOW.safetensors'],
  },
  blink_front_doggystyle_2: {
    high: ['iGoon%20-%20Blink_Front_Doggystyle_I2V_HIGH.safetensors'],
    low: ['iGoon%20-%20Blink_Front_Doggystyle_I2V_LOW.safetensors'],
  },
  blink_front_doggystyle_3: {
    high: ['iGoon%20-%20Blink_Front_Doggystyle_I2V_HIGH.safetensors'],
    low: ['iGoon%20-%20Blink_Front_Doggystyle_I2V_LOW.safetensors'],
  },
  blink_handjob: {
    high: ['iGoon%20-%20Blink_Handjob_I2V_HIGH.safetensors'],
    low: ['iGoon%20-%20Blink_Handjob_I2V_LOW.safetensors'],
  },
  blink_handjob_1: {
    high: ['iGoon%20-%20Blink_Handjob_I2V_HIGH.safetensors'],
    low: ['iGoon%20-%20Blink_Handjob_I2V_LOW.safetensors'],
  },
  blink_handjob_2: {
    high: ['iGoon%20-%20Blink_Handjob_I2V_HIGH.safetensors'],
    low: ['iGoon%20-%20Blink_Handjob_I2V_LOW.safetensors'],
  },
  blink_handjob_3: {
    high: ['iGoon%20-%20Blink_Handjob_I2V_HIGH.safetensors'],
    low: ['iGoon%20-%20Blink_Handjob_I2V_LOW.safetensors'],
  },
  blink_blowjob: {
    high: ['iGOON_Blink_Blowjob_I2V_HIGH%281%29.safetensors'],
    low: ['iGOON_Blink_Blowjob_I2V_LOW%281%29.safetensors'],
  },
  blink_missionary: {
    high: ['iGoon_Blink_Missionary_I2V_HIGH%20v2.safetensors'],
    low: ['iGoon%20-%20Blink_Missionary_I2V_LOW%20v2.safetensors'],
  },
  blink_missionary_1: {
    high: ['iGoon_Blink_Missionary_I2V_HIGH%20v2.safetensors'],
    low: ['iGoon%20-%20Blink_Missionary_I2V_LOW%20v2.safetensors'],
  },
  blink_missionary_2: {
    high: ['iGoon_Blink_Missionary_I2V_HIGH%20v2.safetensors'],
    low: ['iGoon%20-%20Blink_Missionary_I2V_LOW%20v2.safetensors'],
  },
  blink_missionary_3: {
    high: ['iGoon_Blink_Missionary_I2V_HIGH%20v2.safetensors'],
    low: ['iGoon%20-%20Blink_Missionary_I2V_LOW%20v2.safetensors'],
  },
  blink_squatting_cowgirl: {
    high: ['Blink_Squatting_Cowgirl_Position_I2V_HIGH.safetensors'],
    low: ['iGoon%20-%20Blink_Squatting_Cowgirl_Position_I2V_LOW.safetensors'],
  },
  blink_squatting_cowgirl_1: {
    high: ['Blink_Squatting_Cowgirl_Position_I2V_HIGH.safetensors'],
    low: ['iGoon%20-%20Blink_Squatting_Cowgirl_Position_I2V_LOW.safetensors'],
  },
  blink_squatting_cowgirl_2: {
    high: ['Blink_Squatting_Cowgirl_Position_I2V_HIGH.safetensors'],
    low: ['iGoon%20-%20Blink_Squatting_Cowgirl_Position_I2V_LOW.safetensors'],
  },
  sideleg_transition: {
    high: ['sid3l3g_transition_v2.0_H.safetensors'],
    low: ['sid3l3g_transition_v2.0_L.safetensors'],
  },
} as const

type LoraPackOptionId = keyof typeof LORA_PACK_OPTIONS
type LoraPackSelection = {
  id: LoraPackOptionId
  strength: number
}
const FREE_LORA_PACK_OPTION_IDS = new Set<LoraPackOptionId>([
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
const PREMIUM_LORA_PACK_OPTION_IDS = new Set<LoraPackOptionId>(
  (Object.keys(LORA_PACK_OPTIONS) as LoraPackOptionId[]).filter((id) => !FREE_LORA_PACK_OPTION_IDS.has(id)),
)
const SCREEN_FLOOD_LORA_ID: LoraPackOptionId = 'e6b7b9e6b2a1'
const SCREEN_FLOOD_TRIGGER = 'yanmo567'
const SCREEN_FLOOD_PROMPT = 'a huge splash of water erupts from the bottom and submerges the entire screen.'
const LIFT_ONE_LEG_LORA_ID: LoraPackOptionId = 'low_e9ab98e68aace885'
const LIFT_ONE_LEG_PROMPT = 'They lifted one of their legs high up.'
const FACE_DOWN_ASS_UP_LORA_ID: LoraPackOptionId = 'facedownassup'
const FACE_DOWN_ASS_UP_PROMPT =
  'A naked woman is having sex with a man in the face-down ass-up position. She is having sex with a man in the top-down bottom-up position'
const SUSPENDED_CONGRESS_LORA_ID: LoraPackOptionId = 'reverse_suspended_congress'
const SUSPENDED_CONGRESS_PROMPT =
  'A woman is having sex in the reverse_suspended_congress position She spreads her legs and her body moves up and down, while the man thrusts his penis in and out of her vaginal.'
const HIT_THE_FACE_LORA_ID: LoraPackOptionId = 'e68993e884b890e9ab98'
const HIT_THE_FACE_PROMPT =
  'dalian666,Suddenly, a baseball bat hits her face from the right side. Her head jerks sharply to the left due to the impact, and her facial expression is shocked and distorted from the external force, but there is no blood or gore. This moment is captured at the instant of impact, with motion blur on the hair and slight facial deformation, creating a dynamic, cinematic freeze-frame with a shallow depth of field and dramatic lighting effects.'
const FRENCH_KISS_LORA_ID: LoraPackOptionId = 'frenchkiss'
const FRENCH_KISS_PROMPT = 'Two people kiss.'
const GLASS_KISS_LORA_ID: LoraPackOptionId = 'e78ebbe79283'
const GLASS_KISS_PROMPT =
  'boli567,a woman is holding a transparent piece of glass, kissing it so affectionately that saliva drips down the surface.'
const CATCH_POSE_LORA_ID: LoraPackOptionId = 'e68a93e4bd8fe8b7aa'
const CATCH_POSE_PROMPT =
  'First-person perspective, a hand from outside reaches out to grab their neck, forcing them to kneel.'
const POV_MISSIONARY_LORA_ID: LoraPackOptionId = 'pov_missionary'
const POV_MISSIONARY_PROMPT =
  'with her legs spread having sex with a man, A man is thrusting his penis back and forth inside her vagina at the bottom of the screen'
const CUMSHOT_1_LORA_ID: LoraPackOptionId = 'cumshot_aesthetics_1'
const CUMSHOT_1_PROMPT =
  'An adult woman is kneeling. A man enters the frame from the bottom left corner. He ejaculates on her face and into her mouth, with a small amount landing on her nose. The fluid is thick and sticky, clinging like paste before sliding off.'
const CUMSHOT_2_LORA_ID: LoraPackOptionId = 'cumshot_aesthetics_2'
const CUMSHOT_2_PROMPT =
  'An adult woman is sitting. A naked man enters from the right side. He ejaculates on her chest. Thick and heavy, the fluid holds to her body before dripping away.'
const CUMSHOT_3_LORA_ID: LoraPackOptionId = 'cumshot_aesthetics_3'
const CUMSHOT_3_PROMPT =
  'An adult woman is standing. A man enters from below. He ejaculates on her mouth. The sticky fluid briefly clings before slowly sliding off her skin.'
const CUMSHOT_4_LORA_ID: LoraPackOptionId = 'cumshot_aesthetics_4'
const CUMSHOT_4_PROMPT =
  'An adult woman is lying down. A man enters from below. He ejaculates on her stomach. It is thick and sticky, clinging like paste before sliding off slowly.'
const BLINK_TITJOB_1_LORA_ID: LoraPackOptionId = 'blink_titjob_1'
const BLINK_TITJOB_1_PROMPT =
  'The video begins with a close up of an adult woman. The video then jumpcuts to the same adult woman now lying down on a tiled floor of the same location with her breasts positioned around the man\'s erect penis as he thrusts his penis up and down in a titjob motion sliding it between her breasts. She makes various facial expressions during the video, she looks like she is talking and has her eyes wide open with a crazy expression.'
const BLINK_TITJOB_2_LORA_ID: LoraPackOptionId = 'blink_titjob_2'
const BLINK_TITJOB_2_PROMPT =
  'The video begins with a close up of an adult woman. The video then jumpcuts to the same adult woman kneeling in the same location with her breasts positioned around the man\'s erect penis as she moves them up and down in a sliding motion. She makes various facial expressions, she looks like she is talking and has her eyes wide open with a crazy expression.'
const BLINK_BACK_DOGGYSTYLE_1_LORA_ID: LoraPackOptionId = 'blink_back_doggystyle_1'
const BLINK_BACK_DOGGYSTYLE_1_PROMPT =
  'The video begins with a shot of an adult woman. The video then jumpcuts to the same adult woman now having sex in doggystyle position. She is positioned kneeling in the same location. The video is shot from behind as she looks back at the camera with an open mouth expression. He penetrates her vagina from behind. Her legs are close together with the man kneeling behind her over her legs. The man has a wide stance. She is looking directly at the camera fully facing it. She looks back at the camera. She looks at the camera throughout the video.'
const BLINK_BACK_DOGGYSTYLE_2_LORA_ID: LoraPackOptionId = 'blink_back_doggystyle_2'
const BLINK_BACK_DOGGYSTYLE_2_PROMPT =
  'The video begins with shot of an adult woman. The video then jumpcuts to the same adult woman now having sex in doggystyle position in the same location. From an overhead perspective, she is on all fours with her back facing the camera. A man is positioned behind her, his hands gripping her hips as he penetrates her from behind. The adult woman\'s expression changes throughout the scene, showing moments of pleasure and engagement with her partner. Her legs are spread apart with the man in-between her legs. She is looking directly at the camera fully facing it. She looks back at the camera. She looks at the camera throughout the video.'
const BLINK_FACIAL_1_LORA_ID: LoraPackOptionId = 'blink_facial_1'
const BLINK_FACIAL_1_PROMPT =
  'The video begins with a close-up of an adult woman. The video then jumpcuts to the same adult woman now receiving a facial from a man\'s penis. She is kneeling on the floor looking up with an open mouth. The cum shoots all over her face. The man\'s hand holds his erect penis, masturbating his penis and shooting the thick white cum directly onto her face, forehead, eyes, cheek and mouth. The thick white cum slowly drips down her face onto her body. An explosion of thick white cum blasts her face. She looks directly at the camera throughout the video.'
const BLINK_FACIAL_2_LORA_ID: LoraPackOptionId = 'blink_facial_2'
const BLINK_FACIAL_2_PROMPT =
  'The video begins with a close-up of an adult woman. The video then jumpcuts to the same adult woman now receiving a facial from a man\'s penis. She is lying on her back. The cum shoots all over her face. The man\'s hand holds his erect penis, masturbating his penis and shooting the thick white cum directly onto her face, forehead, eyes, cheek and mouth. The thick white cum slowly drips down her face onto her body. An explosion of thick white cum blasts her face. She looks directly at the camera throughout the video.'
const BLINK_HANDJOB_1_LORA_ID: LoraPackOptionId = 'blink_handjob_1'
const BLINK_HANDJOB_1_PROMPT =
  'The video begins with a close-up of an adult woman. The video then jumpcuts to the same adult woman on her stomach with her head resting low in the frame on a man\'s thigh next to his penis on the left of the frame. With her right hand she grasps the man\'s erect penis and moves it up and down the shaft in a steady rhythm, performing the handjob. She goes through various facial expressions throughout the video from happy to gasping, she looks like she is talking. She looks at the camera throughout the video.'
const BLINK_HANDJOB_2_LORA_ID: LoraPackOptionId = 'blink_handjob_2'
const BLINK_HANDJOB_2_PROMPT =
  'The video begins with a close-up of an adult woman. The video then jumpcuts to the same adult woman now kneeling between a man\'s legs with her upper body bent forward over him, and her face close to his lap. With one hand, she grasps the man\'s erect penis and moves it up and down its shaft in a steady rhythm, performing the handjob. She goes through various facial expressions throughout the video from happy to gasping, she looks like she is talking. She looks at the camera throughout the video. The man\'s feet are seen in the background.'
const BLINK_HANDJOB_3_LORA_ID: LoraPackOptionId = 'blink_handjob_3'
const BLINK_HANDJOB_3_PROMPT =
  'The video begins with close-up of an adult woman. The video then jumpcuts to the same adult woman now kneeling on the floor in front of the man who is sitting high above her. She is giving the man\'s penis a handjob with both hands moving them up and down along the shaft. She goes through various facial expressions throughout the video from happy to gasping, she looks like she is talking. The adult woman is looking up at the man. She looks at the camera throughout the video.'
const PAIZURI_LORA_ID: LoraPackOptionId = 'pov_titfuck_paizuri'
const PAIZURI_PROMPT =
  'titJob, paizuri, nakedman and adult woman, gather, fingersTogether. A man is thrusting his penis between her breasts. She rubs her breasts up and down his penis. She gathers her breasts together around the penis, with her fingertips touching together.'
const I2PEE_LORA_ID: LoraPackOptionId = 'i2pee'
const I2PEE_PROMPT = 'piss'
const FRONT_DOGGY_1_LORA_ID: LoraPackOptionId = 'blink_front_doggystyle_1'
const FRONT_DOGGY_1_PROMPT =
  'The video begins with a close-up of an adult woman. The video then jumpcuts to the same adult woman now having sex in doggystyle position. She is lying on her stomach, facing forward, with her head turned slightly to the side as she reacts to the sensations of intercourse. Her facial expressions change throughout the sequence, showing moments of pleasure and exertion, including wide eyes, an open mouth, and clenched fists.'
const FRONT_DOGGY_2_LORA_ID: LoraPackOptionId = 'blink_front_doggystyle_2'
const FRONT_DOGGY_2_PROMPT =
  'The video begins with a close-up of an adult woman. The video then jumpcuts to the same adult woman now having sex with a man in doggystyle position in the same location. She is positioned standing, while the man stands behind her. The man is muscular, his hands are wrapped around the woman\'s stomach holding her upright while embracing her from behind, he holds her close as he thrusts into her. As the scene progresses, she moves rhythmically with him. She is fully nude. The man aggressively rams his hips into her.'
const FRONT_DOGGY_3_LORA_ID: LoraPackOptionId = 'blink_front_doggystyle_3'
const FRONT_DOGGY_3_PROMPT =
  'The video begins with a close-up of an adult woman. The video then jumpcuts to the same adult woman now having sex with a man in doggystyle position in the same location. She is bent over with her back arched and her head tilted down as he stands behind her. He is muscular. The adult woman\'s expression changes throughout the sequence as she reacts to their movements, sometimes looking down, other times up at the camera with an open mouth. The scene is recorded from below looking up. She looks at the camera the entire time. The man aggressively has sex with her. She is fully nude.'
const BLINK_BLOWJOB_LORA_ID: LoraPackOptionId = 'blink_blowjob'
const BLINK_BLOWJOB_PROMPT =
  'An adult woman looking at the camera. The video then jumpcuts to the same adult woman giving a blowjob to a man standing in the same location, looking up as she performs the blowjob on the man. She is kneeling in front of him, she is holding his penis with both hands. She looks at the camera the entire time. She shoves the penis deep in her mouth.'
const HANDJOB_BLOWJOB_COMBO_LORA_ID: LoraPackOptionId = 'handjob_blowjob_combo'
const HANDJOB_BLOWJOB_COMBO_PROMPT = BLINK_BLOWJOB_PROMPT
const BLINK_MISSIONARY_1_LORA_ID: LoraPackOptionId = 'blink_missionary_1'
const BLINK_MISSIONARY_1_PROMPT =
  'The video begins with a close-up of an adult woman. The video then jumpcuts to the same adult woman now having sex in missionary position. She is lying on her back on a bed with a patterned bed spread and pillow with her legs spread wide. A man\'s large penis is visible entering her vagina from below. The man is positioned kneeling between her legs in front of her thrusting his penis into her vagina. Throughout the scene, she appears to be experiencing pleasure, often with her mouth open or eyes closed as she lies back. Her hands hold onto her thighs spreading her legs.'
const BLINK_MISSIONARY_2_LORA_ID: LoraPackOptionId = 'blink_missionary_2'
const BLINK_MISSIONARY_2_PROMPT =
  'The video begins with a close-up of an adult woman. The video then jumpcuts to the same adult woman now having sex in missionary position. She is lying on her back on a bed with a patterned bed spread and pillow with her legs spread with her knees to her chest. A man\'s large penis is visible entering her vagina from below. The man is positioned kneeling between her legs in front of her thrusting his penis into her vagina. Throughout the scene, she appears to be experiencing pleasure, often with her mouth open or eyes closed as she lies back. Her hands hold onto her thighs spreading her legs.'
const BLINK_MISSIONARY_3_LORA_ID: LoraPackOptionId = 'blink_missionary_3'
const BLINK_MISSIONARY_3_PROMPT =
  'The video begins with a close-up of an adult woman. The video then jumpcuts to the same adult woman having sex in missionary position on the edge of a bed with a man\'s erect penis in her vagina. She is shown experiencing various stages of sexual pleasure, with her facial expressions changing from contentment to intense enjoyment as the act continues. She looks at the camera throughout the video.'
const SQUATTING_COWGIRL_1_LORA_ID: LoraPackOptionId = 'blink_squatting_cowgirl_1'
const SQUATTING_COWGIRL_1_PROMPT =
  'The video begins with a close-up of an adult woman. The video then jumpcuts to the same adult woman now having sex with a man in squatting cowgirl position. Her face fills the screen, she is leaning over forwards as she bounces up and down aggressively. His erect penis is in her vagina. She looks at the camera throughout the video. The video is shot from above looking down on the scene.'
const SQUATTING_COWGIRL_2_LORA_ID: LoraPackOptionId = 'blink_squatting_cowgirl_2'
const SQUATTING_COWGIRL_2_PROMPT =
  'The video begins with a close-up of an adult woman. The video then jumpcuts to the same adult woman now having sex with a man in squatting cowgirl position. She is leaning backwards as she bounces up and down aggressively. His erect penis is in her vagina. She looks at the camera throughout the video.'
const SIDELEG_TRANSITION_LORA_ID: LoraPackOptionId = 'sideleg_transition'
const SIDELEG_TRANSITION_PROMPT = 'They are having side sex'

const isLoraPackRoute = (request: Request) => new URL(request.url).pathname.toLowerCase().includes('/api/wan-lora-pack')

const resolveEndpoint = (
  env: Env,
  request: Request,
  mode: GenerationMode = 'i2v',
  i2vVariant: I2VVariant = 'default',
) => {
  if (mode === 'i2v') {
    if (isLoraPackRoute(request)) {
      return (env.RUNPOD_WAN_LORA_PACK_ENDPOINT_URL ?? DEFAULT_LORA_PACK_ENDPOINT).replace(/\/$/, '')
    }
    const i2vEndpoint =
      i2vVariant === 'dasiwa'
        ? (
            env.RUNPOD_WAN_DASIWA_ENDPOINT_URL ??
            env.RUNPOD_WAN_RAPID_FASTMOVE_ENDPOINT_URL ??
            env.RUNPOD_WAN_ENDPOINT_URL ??
            env.RUNPOD_ENDPOINT_URL
          )
        : (
            env.RUNPOD_WAN_RAPID_FASTMOVE_ENDPOINT_URL ??
            env.RUNPOD_WAN_ENDPOINT_URL ??
            env.RUNPOD_ENDPOINT_URL
          )
    return i2vEndpoint?.replace(/\/$/, '')
  }
  return (env.RUNPOD_WAN_ENDPOINT_URL ?? env.RUNPOD_ENDPOINT_URL)?.replace(/\/$/, '')
}

type NodeMapEntry = {
  id: string
  input: string
}

type NodeMapValue = NodeMapEntry | NodeMapEntry[]

type NodeMap = Partial<{
  image: NodeMapValue
  video: NodeMapValue
  prompt: NodeMapValue
  negative_prompt: NodeMapValue
  seed: NodeMapValue
  steps: NodeMapValue
  cfg: NodeMapValue
  width: NodeMapValue
  height: NodeMapValue
  num_frames: NodeMapValue
  fps: NodeMapValue
  start_step: NodeMapValue
  end_step: NodeMapValue
}>

type GenerationMode = 'i2v' | 'animate'
type I2VVariant = 'default' | 'dasiwa'

const resolveI2VVariant = (request: Request): I2VVariant => {
  const path = new URL(request.url).pathname.toLowerCase()
  return path.includes('/api/wan-dasiwa') ? 'dasiwa' : 'default'
}

const SIGNUP_TICKET_GRANT = 3
const DEFAULT_VIDEO_TICKET_COST = 1
const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const MAX_VIDEO_BYTES = 150 * 1024 * 1024
const MAX_PROMPT_LENGTH = 5000
const MAX_NEGATIVE_PROMPT_LENGTH = 500
const FIXED_STEPS = 4
const FIXED_STEPS_ANIMATE = 6
const LORA_PACK_STEPS = 4
const LORA_PACK_SPLIT_STEP = 1
const LORA_PACK_SHIFT = 2
const MIN_DIMENSION = 256
const MAX_DIMENSION = 3000
const MIN_CFG = 0
const MAX_CFG = 10
const FIXED_FPS_DEFAULT = 10
const FIXED_FPS_DASIWA = 16
const LORA_PACK_FPS = 10
// Wan i2v length is most stable with 4n+1 frames.
const VIDEO_DURATION_OPTIONS_DEFAULT = [
  { seconds: 5, frames: 53, ticketCost: 1 },
  { seconds: 7, frames: 73, ticketCost: 3 },
  { seconds: 10, frames: 101, ticketCost: 6 },
] as const
const VIDEO_DURATION_OPTIONS_DASIWA = [
  { seconds: 5, frames: 81, ticketCost: 1 },
  { seconds: 7, frames: 113, ticketCost: 3 },
  { seconds: 9, frames: 145, ticketCost: 5 },
] as const
const VIDEO_DURATION_OPTIONS_LORA_PACK = [
  { seconds: 5, frames: 53, ticketCost: 1 },
  { seconds: 7, frames: 73, ticketCost: 2 },
  { seconds: 10, frames: 101, ticketCost: 3 },
] as const
const FIXED_ANIMATE_FRAMES = 77
const INTERNAL_SERVER_ERROR_MESSAGE = '\u30b5\u30fc\u30d0\u30fc\u5185\u90e8\u30a8\u30e9\u30fc\u304c\u767a\u751f\u3057\u307e\u3057\u305f\u3002\u6642\u9593\u3092\u304a\u3044\u3066\u518d\u5ea6\u304a\u8a66\u3057\u304f\u3060\u3055\u3044\u3002'
const INTERNAL_ERROR_DETAIL = 'internal_error'
const ERROR_LOGIN_REQUIRED = '\u30ed\u30b0\u30a4\u30f3\u304c\u5fc5\u8981\u3067\u3059\u3002'
const ERROR_AUTH_FAILED = '\u8a8d\u8a3c\u306b\u5931\u6557\u3057\u307e\u3057\u305f\u3002'
const ERROR_GOOGLE_ONLY = 'Google\u30ed\u30b0\u30a4\u30f3\u306e\u307f\u5bfe\u5fdc\u3057\u3066\u3044\u307e\u3059\u3002'
const ERROR_SUPABASE_NOT_SET =
  'SUPABASE_URL \u307e\u305f\u306f SUPABASE_SERVICE_ROLE_KEY \u304c\u8a2d\u5b9a\u3055\u308c\u3066\u3044\u307e\u305b\u3093\u3002'
const ERROR_ID_REQUIRED = 'id\u304c\u5fc5\u8981\u3067\u3059\u3002'
const ERROR_JOB_NOT_FOUND = 'Job not found.'
const ERROR_I2V_IMAGE_REQUIRED = 'i2v\u306b\u306f\u753b\u50cf\u304c\u5fc5\u8981\u3067\u3059\u3002'
const ERROR_ANIMATE_VIDEO_REQUIRED = 'animate\u306b\u306f\u53c2\u7167\u52d5\u753b\u304c\u5fc5\u8981\u3067\u3059\u3002'
const ERROR_IMAGE_READ_FAILED =
  '\u753b\u50cf\u306e\u8aad\u307f\u53d6\u308a\u306b\u5931\u6557\u3057\u307e\u3057\u305f\u3002\u753b\u50cf\u3092\u78ba\u8a8d\u3057\u3066\u518d\u5ea6\u304a\u8a66\u3057\u304f\u3060\u3055\u3044\u3002'
const ERROR_VIDEO_READ_FAILED =
  '\u52d5\u753b\u306e\u8aad\u307f\u53d6\u308a\u306b\u5931\u6557\u3057\u307e\u3057\u305f\u3002\u52d5\u753b\u3092\u78ba\u8a8d\u3057\u3066\u518d\u5ea6\u304a\u8a66\u3057\u304f\u3060\u3055\u3044\u3002'
const UNDERAGE_BLOCK_MESSAGE =
  '\u3053\u306e\u753b\u50cf\u306b\u306f\u66b4\u529b\u7684\u306a\u8868\u73fe\u3001\u4f4e\u5e74\u9f62\u3001\u307e\u305f\u306f\u898f\u7d04\u9055\u53cd\u306e\u53ef\u80fd\u6027\u304c\u3042\u308a\u307e\u3059\u3002\u5225\u306e\u753b\u50cf\u3067\u304a\u8a66\u3057\u304f\u3060\u3055\u3044\u3002'

const HIDDEN_MODEL_NAME_PATTERN =
  /Irodori-TTS-500M-v2-VoiceDesign|Irodori-TTS-500M-v2|Irodori-TTS|Irodori|VoiceDesign|MMAudio|Wav2Lip|WAV2LIP/gi
const HIDDEN_MODEL_FILE_PATTERN =
  /[A-Za-z0-9_./%\-]+?\.(safetensors|gguf|onnx|pt|pth|ckpt|bin)/gi
const GENERIC_MODEL_LABEL = 'model'
type VideoDurationOption = (typeof VIDEO_DURATION_OPTIONS_DEFAULT)[number]

const getVideoDurationOptions = (i2vVariant: I2VVariant, isLoraPack = false) => {
  if (isLoraPack) return VIDEO_DURATION_OPTIONS_LORA_PACK
  return i2vVariant === 'dasiwa' ? VIDEO_DURATION_OPTIONS_DASIWA : VIDEO_DURATION_OPTIONS_DEFAULT
}

const getDefaultVideoDurationOption = (i2vVariant: I2VVariant, isLoraPack = false): VideoDurationOption =>
  getVideoDurationOptions(i2vVariant, isLoraPack)[0] as VideoDurationOption

const resolveVideoDurationOption = (seconds: number, i2vVariant: I2VVariant, isLoraPack = false) =>
  getVideoDurationOptions(i2vVariant, isLoraPack).find((option) => option.seconds === seconds) ?? null

const resolveVideoDurationFromInput = (secondsRaw: unknown, i2vVariant: I2VVariant, isLoraPack = false) => {
  if (secondsRaw === undefined || secondsRaw === null || secondsRaw === '') {
    return { option: getDefaultVideoDurationOption(i2vVariant, isLoraPack), error: null as string | null }
  }

  const parsedSeconds = Math.floor(Number(secondsRaw))
  if (!Number.isFinite(parsedSeconds)) {
    return { option: null as null | VideoDurationOption, error: 'seconds must be a number.' }
  }

  const option = resolveVideoDurationOption(parsedSeconds, i2vVariant, isLoraPack)
  if (!option) {
    return { option: getDefaultVideoDurationOption(i2vVariant, isLoraPack), error: null as string | null }
  }

  return { option, error: null as string | null }
}

const parseTicketMetadata = (value: unknown) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

type TicketEventRow = {
  usage_id: string
  user_id: string | null
  email: string | null
  delta: number | null
  metadata: Record<string, unknown> | null
}

const normalizeEmail = (value: string | null | undefined) => (value ?? '').trim().toLowerCase()

const isUsageOwnedByUser = (
  event: Pick<TicketEventRow, 'user_id' | 'email'>,
  user: User,
) => {
  if (event.user_id && event.user_id === user.id) return true
  const userEmail = normalizeEmail(user.email ?? '')
  return Boolean(userEmail && normalizeEmail(event.email) === userEmail)
}

const fetchUsageEvent = async (
  admin: ReturnType<typeof createClient>,
  usageId: string,
) => {
  const { data, error } = await admin
    .from('ticket_events')
    .select('usage_id, user_id, email, delta, metadata')
    .eq('usage_id', usageId)
    .maybeSingle()

  if (error || !data) {
    return { event: null as TicketEventRow | null, error }
  }

  return {
    event: {
      usage_id: String(data.usage_id),
      user_id: data.user_id ? String(data.user_id) : null,
      email: data.email ? String(data.email) : null,
      delta: Number.isFinite(Number(data.delta)) ? Number(data.delta) : null,
      metadata: parseTicketMetadata(data.metadata),
    } satisfies TicketEventRow,
    error: null,
  }
}

const requireOwnedUsageChargeEvent = async (
  admin: ReturnType<typeof createClient>,
  user: User,
  usageId: string,
  corsHeaders: HeadersInit,
) => {
  const { event, error } = await fetchUsageEvent(admin, usageId)
  if (error) {
    return { response: jsonResponse({ error: INTERNAL_SERVER_ERROR_MESSAGE }, 500, corsHeaders) }
  }
  if (!event || !isUsageOwnedByUser(event, user) || Number(event.delta) >= 0) {
    return { response: jsonResponse({ error: ERROR_JOB_NOT_FOUND }, 404, corsHeaders) }
  }
  return { event }
}
const getWorkflowTemplate = async (mode: GenerationMode, i2vVariant: I2VVariant = 'default') =>
  (mode === 'animate'
    ? workflowAnimateTemplate
    : i2vVariant === 'dasiwa'
      ? workflowDasiwaI2VTemplate
      : workflowI2VTemplate) as Record<string, unknown>

const getNodeMap = async (mode: GenerationMode) =>
  (mode === 'animate'
    ? nodeMapAnimateTemplate
    : nodeMapI2VTemplate) as NodeMap

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

const extractBearerToken = (request: Request) => {
  const header = request.headers.get('Authorization') || ''
  const match = header.match(/Bearer\s+(.+)/i)
  return match ? match[1] : ''
}

const getSupabaseAdmin = (env: Env) => {
  const url = env.SUPABASE_URL
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) return null
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

const isGoogleUser = (user: User) => {
  if (user.app_metadata?.provider === 'google') return true
  if (Array.isArray(user.identities)) {
    return user.identities.some((identity) => identity.provider === 'google')
  }
  return false
}

const requireGoogleUser = async (request: Request, env: Env, corsHeaders: HeadersInit) => {
  const token = extractBearerToken(request)
  if (!token) {
    return { response: jsonResponse({ error: ERROR_LOGIN_REQUIRED }, 401, corsHeaders) }
  }
  const admin = getSupabaseAdmin(env)
  if (!admin) {
    return { response: jsonResponse({ error: ERROR_SUPABASE_NOT_SET }, 500, corsHeaders) }
  }
  const { data, error } = await getSupabaseUserWithRetry(admin, token)
  if (error || !data?.user) {
    return { response: jsonResponse({ error: ERROR_AUTH_FAILED }, 401, corsHeaders) }
  }
  if (!isGoogleUser(data.user)) {
    return { response: jsonResponse({ error: ERROR_GOOGLE_ONLY }, 403, corsHeaders) }
  }
  return { admin, user: data.user }
}

const makeUsageId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

const fetchTicketRow = async (
  admin: ReturnType<typeof createClient>,
  user: User,
) => {
  const email = user.email
  const { data: byUser, error: userError } = await admin
    .from('user_tickets')
    .select('id, email, user_id, tickets')
    .eq('user_id', user.id)
    .maybeSingle()
  if (userError) {
    return { error: userError }
  }
  if (byUser) {
    return { data: byUser, error: null }
  }
  if (!email) {
    return { data: null, error: null }
  }
  const { data: byEmail, error: emailError } = await admin
    .from('user_tickets')
    .select('id, email, user_id, tickets')
    .ilike('email', email)
    .maybeSingle()
  if (emailError) {
    return { error: emailError }
  }
  return { data: byEmail, error: null }
}

const ensureTicketRow = async (
  admin: ReturnType<typeof createClient>,
  user: User,
) => {
  const email = user.email
  if (!email) {
    return { data: null, error: null }
  }

  const { data: existing, error } = await fetchTicketRow(admin, user)
  if (error) {
    return { data: null, error }
  }
  if (existing) {
    return { data: existing, error: null, created: false }
  }

  const { data: inserted, error: insertError } = await admin
    .from('user_tickets')
    .insert({ email, user_id: user.id, tickets: SIGNUP_TICKET_GRANT })
    .select('id, email, user_id, tickets')
    .maybeSingle()

  if (insertError || !inserted) {
    const { data: retry, error: retryError } = await fetchTicketRow(admin, user)
    if (retryError) {
      return { data: null, error: retryError }
    }
    return { data: retry, error: null, created: false }
  }

  const grantUsageId = makeUsageId()
  await admin.from('ticket_events').insert({
    usage_id: grantUsageId,
    email,
    user_id: user.id,
    delta: SIGNUP_TICKET_GRANT,
    reason: 'signup_bonus',
    metadata: { source: 'auto_grant' },
  })

  return { data: inserted, error: null, created: true }
}

const ensureTicketAvailable = async (
  admin: ReturnType<typeof createClient>,
  user: User,
  requiredTickets = 1,
  corsHeaders: HeadersInit = {},
) => {
  const email = user.email
  if (!email) {
    return { response: jsonResponse({ error: 'Email not available.' }, 400, corsHeaders) }
  }

  const { data: existing, error } = await ensureTicketRow(admin, user)

  if (error) {
    return { response: jsonResponse({ error: INTERNAL_SERVER_ERROR_MESSAGE }, 500, corsHeaders) }
  }

  if (!existing) {
    return { response: jsonResponse({ error: 'No tickets available.' }, 402, corsHeaders) }
  }

  if (!existing.user_id) {
    await admin.from('user_tickets').update({ user_id: user.id }).eq('id', existing.id)
  }

  if (existing.tickets < requiredTickets) {
    return { response: jsonResponse({ error: 'No tickets remaining.' }, 402, corsHeaders) }
  }

  return { existing }
}

const consumeTicket = async (
  admin: ReturnType<typeof createClient>,
  user: User,
  metadata: Record<string, unknown>,
  usageId?: string,
  ticketCost = 1,
  corsHeaders: HeadersInit = {},
) => {
  const cost = Math.max(1, Math.floor(ticketCost))
  const email = user.email
  if (!email) {
    return { response: jsonResponse({ error: 'Email not available.' }, 400, corsHeaders) }
  }

  const { data: existing, error } = await fetchTicketRow(admin, user)

  if (error) {
    return { response: jsonResponse({ error: INTERNAL_SERVER_ERROR_MESSAGE }, 500, corsHeaders) }
  }

  if (!existing) {
    return { response: jsonResponse({ error: 'No tickets available.' }, 402, corsHeaders) }
  }

  if (!existing.user_id) {
    await admin.from('user_tickets').update({ user_id: user.id }).eq('id', existing.id)
  }

  const resolvedUsageId = usageId ?? makeUsageId()
  const { data: rpcData, error: rpcError } = await admin.rpc('consume_tickets', {
    p_ticket_id: existing.id,
    p_usage_id: resolvedUsageId,
    p_cost: cost,
    p_reason: 'generate_video',
    p_metadata: metadata,
  })

  if (rpcError) {
    const message = rpcError.message ?? 'Failed to update tickets.'
    if (message.includes('INSUFFICIENT_TICKETS')) {
      return { response: jsonResponse({ error: 'No tickets remaining.' }, 402, corsHeaders) }
    }
    if (message.includes('INVALID')) {
      return { response: jsonResponse({ error: 'Invalid ticket request.' }, 400, corsHeaders) }
    }
    return { response: jsonResponse({ error: INTERNAL_SERVER_ERROR_MESSAGE }, 500, corsHeaders) }
  }

  const result = Array.isArray(rpcData) ? rpcData[0] : rpcData
  const ticketsLeft = Number(result?.tickets_left)
  const alreadyConsumed = Boolean(result?.already_consumed)
  return {
    ticketsLeft: Number.isFinite(ticketsLeft) ? ticketsLeft : undefined,
    alreadyConsumed,
  }
}

const refundTicket = async (
  admin: ReturnType<typeof createClient>,
  user: User,
  metadata: Record<string, unknown>,
  usageId?: string,
  ticketCost = 1,
  corsHeaders: HeadersInit = {},
) => {
  const refundAmount = Math.max(1, Math.floor(ticketCost))
  const email = user.email
  if (!email || !usageId) {
    return { skipped: true }
  }

  const { data: chargeEvent, error: chargeError } = await admin
    .from('ticket_events')
    .select('usage_id, user_id, email, delta')
    .eq('usage_id', usageId)
    .maybeSingle()

  if (chargeError) {
    return { response: jsonResponse({ error: INTERNAL_SERVER_ERROR_MESSAGE }, 500, corsHeaders) }
  }

  if (!chargeEvent) {
    return { skipped: true }
  }

  const chargeDelta = Number((chargeEvent as { delta?: unknown }).delta)
  const chargeOwner = {
    user_id: (chargeEvent as { user_id?: unknown }).user_id ? String((chargeEvent as { user_id?: unknown }).user_id) : null,
    email: (chargeEvent as { email?: unknown }).email ? String((chargeEvent as { email?: unknown }).email) : null,
  }
  if (!Number.isFinite(chargeDelta) || chargeDelta >= 0 || !isUsageOwnedByUser(chargeOwner, user)) {
    return { skipped: true }
  }

  const refundUsageId = `${usageId}:refund`
  const { data: existingRefund, error: refundCheckError } = await admin
    .from('ticket_events')
    .select('usage_id')
    .eq('usage_id', refundUsageId)
    .maybeSingle()

  if (refundCheckError) {
    return { response: jsonResponse({ error: INTERNAL_SERVER_ERROR_MESSAGE }, 500, corsHeaders) }
  }

  if (existingRefund) {
    return { alreadyRefunded: true }
  }

  const { data: existing, error } = await ensureTicketRow(admin, user)

  if (error) {
    return { response: jsonResponse({ error: INTERNAL_SERVER_ERROR_MESSAGE }, 500, corsHeaders) }
  }

  if (!existing) {
    return { response: jsonResponse({ error: 'No tickets available.' }, 402, corsHeaders) }
  }

  if (!existing.user_id) {
    await admin.from('user_tickets').update({ user_id: user.id }).eq('id', existing.id)
  }

  const { data: rpcData, error: rpcError } = await admin.rpc('refund_tickets', {
    p_ticket_id: existing.id,
    p_usage_id: refundUsageId,
    p_amount: refundAmount,
    p_reason: 'refund',
    p_metadata: metadata,
  })

  if (rpcError) {
    const message = rpcError.message ?? 'Failed to refund tickets.'
    if (message.includes('INVALID')) {
      return { response: jsonResponse({ error: 'Invalid ticket request.' }, 400, corsHeaders) }
    }
    return { response: jsonResponse({ error: INTERNAL_SERVER_ERROR_MESSAGE }, 500, corsHeaders) }
  }

  const result = Array.isArray(rpcData) ? rpcData[0] : rpcData
  const ticketsLeft = Number(result?.tickets_left)
  const alreadyRefunded = Boolean(result?.already_refunded)
  return {
    ticketsLeft: Number.isFinite(ticketsLeft) ? ticketsLeft : undefined,
    alreadyRefunded,
  }
}

const resolveUsageTicketMeta = (event: TicketEventRow | null) => {
  if (!event) {
    return { ticketCost: null as null | number, seconds: null as null | number }
  }

  let ticketCost: null | number = null
  const delta = Number(event.delta)
  if (Number.isFinite(delta) && delta < 0) {
    ticketCost = Math.max(1, Math.floor(Math.abs(delta)))
  }

  const metadata = event.metadata
  const metaCost = Number(metadata?.ticket_cost)
  if (Number.isFinite(metaCost) && metaCost > 0) {
    ticketCost = Math.max(1, Math.floor(metaCost))
  }

  const metaSeconds = Number(metadata?.seconds)
  const seconds = Number.isFinite(metaSeconds) && metaSeconds > 0 ? Math.floor(metaSeconds) : null
  return { ticketCost, seconds }
}

const hasOutputList = (value: unknown) => Array.isArray(value) && value.length > 0

const hasOutputString = (value: unknown) => typeof value === 'string' && value.trim() !== ''

const hasAssets = (payload: any) => {
  if (!payload || typeof payload !== 'object') return false
  const data = payload as Record<string, unknown>
  const listCandidates = [
    data.images,
    data.videos,
    data.gifs,
    data.outputs,
    data.output_images,
    data.output_videos,
    data.data,
  ]
  if (listCandidates.some(hasOutputList)) return true
  const singleCandidates = [
    data.image,
    data.video,
    data.gif,
    data.output_image,
    data.output_video,
    data.output_image_base64,
  ]
  return singleCandidates.some(hasOutputString)
}

const hasOutputError = (payload: any) =>
  Boolean(
    payload?.error ||
      payload?.output?.error ||
      payload?.result?.error ||
      payload?.output?.output?.error ||
      payload?.result?.output?.error,
  )

const isFailureStatus = (payload: any) => {
  const status = String(payload?.status ?? payload?.state ?? '').toLowerCase()
  return status.includes('fail') || status.includes('error') || status.includes('cancel')
}

const shouldConsumeTicket = (payload: any) => {
  const status = String(payload?.status ?? payload?.state ?? '').toLowerCase()
  const isFailure = status.includes('fail') || status.includes('error') || status.includes('cancel')
  const isSuccess =
    status.includes('complete') ||
    status.includes('success') ||
    status.includes('succeed') ||
    status.includes('finished')
  const hasAnyAssets =
    hasAssets(payload) ||
    hasAssets(payload?.output) ||
    hasAssets(payload?.result) ||
    hasAssets(payload?.output?.output) ||
    hasAssets(payload?.result?.output)
  if (isFailure) return false
  if (hasOutputError(payload)) return false
  return isSuccess || hasAnyAssets
}

const extractJobId = (payload: any) =>
  payload?.id || payload?.jobId || payload?.job_id || payload?.output?.id

const stripDataUrl = (value: string) => {
  const comma = value.indexOf(',')
  if (value.startsWith('data:') && comma !== -1) {
    return value.slice(comma + 1)
  }
  return value
}

const sanitizeText = (value: string) => {
  if (!value) return value
  if (value.startsWith('data:')) return value
  return value
    .replace(HIDDEN_MODEL_NAME_PATTERN, GENERIC_MODEL_LABEL)
    .replace(HIDDEN_MODEL_FILE_PATTERN, `${GENERIC_MODEL_LABEL}.bin`)
}

const sanitizePayload = (value: unknown): unknown => {
  if (typeof value === 'string') {
    if (value.length > 2000 && value.startsWith('data:')) return value
    return sanitizeText(value)
  }
  if (Array.isArray(value)) return value.map((item) => sanitizePayload(item))
  if (value && typeof value === 'object') {
    const next: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value)) {
      next[key] = sanitizePayload(entry)
    }
    return next
  }
  return value
}

const isHttpUrl = (value: string) => /^https?:\/\//i.test(value.trim())

const estimateBase64Bytes = (value: string) => {
  const trimmed = value.trim()
  const padding = trimmed.endsWith('==') ? 2 : trimmed.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor((trimmed.length * 3) / 4) - padding)
}

const ensureBase64Input = (label: string, value: unknown, maxBytes = MAX_IMAGE_BYTES) => {
  if (typeof value !== 'string' || !value.trim()) return ''
  const trimmed = value.trim()
  if (isHttpUrl(trimmed)) {
    throw new Error(`${label} must be base64.`)
  }
  const base64 = stripDataUrl(trimmed)
  if (!base64) return ''
  const bytes = estimateBase64Bytes(base64)
  if (bytes > maxBytes) {
    throw new Error(`${label} is too large.`)
  }
  return base64
}

const setInputValue = (
  workflow: Record<string, any>,
  entry: NodeMapEntry,
  value: unknown,
) => {
  const node = workflow[entry.id]
  if (!node?.inputs) {
    throw new Error(`Node ${entry.id} not found in workflow.`)
  }
  node.inputs[entry.input] = value
}

const applyNodeMap = (
  workflow: Record<string, any>,
  nodeMap: NodeMap,
  values: Record<string, unknown>,
) => {
  for (const [key, value] of Object.entries(values)) {
    const entry = nodeMap[key as keyof NodeMap]
    if (!entry || value === undefined || value === null) continue
    const entries = Array.isArray(entry) ? entry : [entry]
    for (const item of entries) {
      setInputValue(workflow, item, value)
    }
  }
}

const parseLoraPackSelections = (value: unknown) => {
  if (value === undefined || value === null || value === '') {
    return { selections: [] as LoraPackSelection[], error: null as string | null }
  }
  if (!Array.isArray(value)) {
    return { selections: [] as LoraPackSelection[], error: 'loras must be an array.' }
  }
  if (value.length > MAX_LORA_PACK_SELECTIONS) {
    return {
      selections: [] as LoraPackSelection[],
      error: `loras can include up to ${MAX_LORA_PACK_SELECTIONS} items.`,
    }
  }

  const selected = new Map<LoraPackOptionId, LoraPackSelection>()
  for (const item of value) {
    const idRaw =
      typeof item === 'string'
        ? item
        : item && typeof item === 'object' && !Array.isArray(item)
          ? (item as { id?: unknown }).id
          : null
    if (typeof idRaw !== 'string' || !idRaw) {
      return { selections: [] as LoraPackSelection[], error: 'Invalid lora item.' }
    }
    if (!(idRaw in LORA_PACK_OPTIONS)) {
      return { selections: [] as LoraPackSelection[], error: 'Unknown lora id.' }
    }

    const strengthRaw =
      item && typeof item === 'object' && !Array.isArray(item)
        ? (item as { strength?: unknown }).strength
        : undefined
    const strength = strengthRaw === undefined || strengthRaw === null || strengthRaw === ''
      ? DEFAULT_LORA_PACK_STRENGTH
      : Number(strengthRaw)
    if (!Number.isFinite(strength) || strength < MIN_LORA_PACK_STRENGTH || strength > MAX_LORA_PACK_STRENGTH) {
      return {
        selections: [] as LoraPackSelection[],
        error: `lora strength must be between ${MIN_LORA_PACK_STRENGTH} and ${MAX_LORA_PACK_STRENGTH}.`,
      }
    }

    const normalizedStrength = Math.round(strength * 100) / 100
    if (normalizedStrength < ACTIVE_LORA_PACK_STRENGTH) continue

    selected.set(idRaw as LoraPackOptionId, {
      id: idRaw as LoraPackOptionId,
      strength: normalizedStrength,
    })
  }

  return { selections: [...selected.values()], error: null }
}

const withLoraPackTriggers = (prompt: string, selections: readonly LoraPackSelection[]) => {
  let nextPrompt = prompt.trim()
  if (selections.some((selection) => selection.id === SCREEN_FLOOD_LORA_ID)) {
    if (!new RegExp(`(^|\\s|,)${SCREEN_FLOOD_TRIGGER}(\\s|,|$)`, 'i').test(nextPrompt)) {
      nextPrompt = nextPrompt ? `${SCREEN_FLOOD_TRIGGER}, ${nextPrompt}` : SCREEN_FLOOD_TRIGGER
    }
    if (!nextPrompt.toLowerCase().includes(SCREEN_FLOOD_PROMPT.toLowerCase())) {
      nextPrompt = nextPrompt ? `${nextPrompt} ${SCREEN_FLOOD_PROMPT}` : SCREEN_FLOOD_PROMPT
    }
  }
  if (selections.some((selection) => selection.id === LIFT_ONE_LEG_LORA_ID)) {
    if (!nextPrompt.toLowerCase().includes(LIFT_ONE_LEG_PROMPT.toLowerCase())) {
      nextPrompt = nextPrompt ? `${nextPrompt} ${LIFT_ONE_LEG_PROMPT}` : LIFT_ONE_LEG_PROMPT
    }
  }
  if (selections.some((selection) => selection.id === FACE_DOWN_ASS_UP_LORA_ID)) {
    if (!nextPrompt.toLowerCase().includes(FACE_DOWN_ASS_UP_PROMPT.toLowerCase())) {
      nextPrompt = nextPrompt ? `${nextPrompt} ${FACE_DOWN_ASS_UP_PROMPT}` : FACE_DOWN_ASS_UP_PROMPT
    }
  }
  if (selections.some((selection) => selection.id === SUSPENDED_CONGRESS_LORA_ID)) {
    if (!nextPrompt.toLowerCase().includes(SUSPENDED_CONGRESS_PROMPT.toLowerCase())) {
      nextPrompt = nextPrompt ? `${nextPrompt} ${SUSPENDED_CONGRESS_PROMPT}` : SUSPENDED_CONGRESS_PROMPT
    }
  }
  if (selections.some((selection) => selection.id === HIT_THE_FACE_LORA_ID)) {
    if (!nextPrompt.toLowerCase().includes(HIT_THE_FACE_PROMPT.toLowerCase())) {
      nextPrompt = nextPrompt ? `${nextPrompt} ${HIT_THE_FACE_PROMPT}` : HIT_THE_FACE_PROMPT
    }
  }
  if (selections.some((selection) => selection.id === FRENCH_KISS_LORA_ID)) {
    if (!nextPrompt.toLowerCase().includes(FRENCH_KISS_PROMPT.toLowerCase())) {
      nextPrompt = nextPrompt ? `${nextPrompt} ${FRENCH_KISS_PROMPT}` : FRENCH_KISS_PROMPT
    }
  }
  if (selections.some((selection) => selection.id === GLASS_KISS_LORA_ID)) {
    if (!nextPrompt.toLowerCase().includes(GLASS_KISS_PROMPT.toLowerCase())) {
      nextPrompt = nextPrompt ? `${nextPrompt} ${GLASS_KISS_PROMPT}` : GLASS_KISS_PROMPT
    }
  }
  if (selections.some((selection) => selection.id === CATCH_POSE_LORA_ID)) {
    if (!nextPrompt.toLowerCase().includes(CATCH_POSE_PROMPT.toLowerCase())) {
      nextPrompt = nextPrompt ? `${nextPrompt} ${CATCH_POSE_PROMPT}` : CATCH_POSE_PROMPT
    }
  }
  if (selections.some((selection) => selection.id === POV_MISSIONARY_LORA_ID)) {
    if (!nextPrompt.toLowerCase().includes(POV_MISSIONARY_PROMPT.toLowerCase())) {
      nextPrompt = nextPrompt ? `${nextPrompt} ${POV_MISSIONARY_PROMPT}` : POV_MISSIONARY_PROMPT
    }
  }
  if (selections.some((selection) => selection.id === CUMSHOT_1_LORA_ID)) {
    if (!nextPrompt.toLowerCase().includes(CUMSHOT_1_PROMPT.toLowerCase())) {
      nextPrompt = nextPrompt ? `${nextPrompt} ${CUMSHOT_1_PROMPT}` : CUMSHOT_1_PROMPT
    }
  }
  if (selections.some((selection) => selection.id === CUMSHOT_2_LORA_ID)) {
    if (!nextPrompt.toLowerCase().includes(CUMSHOT_2_PROMPT.toLowerCase())) {
      nextPrompt = nextPrompt ? `${nextPrompt} ${CUMSHOT_2_PROMPT}` : CUMSHOT_2_PROMPT
    }
  }
  if (selections.some((selection) => selection.id === CUMSHOT_3_LORA_ID)) {
    if (!nextPrompt.toLowerCase().includes(CUMSHOT_3_PROMPT.toLowerCase())) {
      nextPrompt = nextPrompt ? `${nextPrompt} ${CUMSHOT_3_PROMPT}` : CUMSHOT_3_PROMPT
    }
  }
  if (selections.some((selection) => selection.id === CUMSHOT_4_LORA_ID)) {
    if (!nextPrompt.toLowerCase().includes(CUMSHOT_4_PROMPT.toLowerCase())) {
      nextPrompt = nextPrompt ? `${nextPrompt} ${CUMSHOT_4_PROMPT}` : CUMSHOT_4_PROMPT
    }
  }
  if (selections.some((selection) => selection.id === BLINK_TITJOB_1_LORA_ID)) {
    if (!nextPrompt.toLowerCase().includes(BLINK_TITJOB_1_PROMPT.toLowerCase())) {
      nextPrompt = nextPrompt ? `${nextPrompt} ${BLINK_TITJOB_1_PROMPT}` : BLINK_TITJOB_1_PROMPT
    }
  }
  if (selections.some((selection) => selection.id === BLINK_TITJOB_2_LORA_ID)) {
    if (!nextPrompt.toLowerCase().includes(BLINK_TITJOB_2_PROMPT.toLowerCase())) {
      nextPrompt = nextPrompt ? `${nextPrompt} ${BLINK_TITJOB_2_PROMPT}` : BLINK_TITJOB_2_PROMPT
    }
  }
  if (selections.some((selection) => selection.id === BLINK_BACK_DOGGYSTYLE_1_LORA_ID)) {
    if (!nextPrompt.toLowerCase().includes(BLINK_BACK_DOGGYSTYLE_1_PROMPT.toLowerCase())) {
      nextPrompt = nextPrompt ? `${nextPrompt} ${BLINK_BACK_DOGGYSTYLE_1_PROMPT}` : BLINK_BACK_DOGGYSTYLE_1_PROMPT
    }
  }
  if (selections.some((selection) => selection.id === BLINK_BACK_DOGGYSTYLE_2_LORA_ID)) {
    if (!nextPrompt.toLowerCase().includes(BLINK_BACK_DOGGYSTYLE_2_PROMPT.toLowerCase())) {
      nextPrompt = nextPrompt ? `${nextPrompt} ${BLINK_BACK_DOGGYSTYLE_2_PROMPT}` : BLINK_BACK_DOGGYSTYLE_2_PROMPT
    }
  }
  if (selections.some((selection) => selection.id === BLINK_FACIAL_1_LORA_ID)) {
    if (!nextPrompt.toLowerCase().includes(BLINK_FACIAL_1_PROMPT.toLowerCase())) {
      nextPrompt = nextPrompt ? `${nextPrompt} ${BLINK_FACIAL_1_PROMPT}` : BLINK_FACIAL_1_PROMPT
    }
  }
  if (selections.some((selection) => selection.id === BLINK_FACIAL_2_LORA_ID)) {
    if (!nextPrompt.toLowerCase().includes(BLINK_FACIAL_2_PROMPT.toLowerCase())) {
      nextPrompt = nextPrompt ? `${nextPrompt} ${BLINK_FACIAL_2_PROMPT}` : BLINK_FACIAL_2_PROMPT
    }
  }
  if (selections.some((selection) => selection.id === BLINK_HANDJOB_1_LORA_ID)) {
    if (!nextPrompt.toLowerCase().includes(BLINK_HANDJOB_1_PROMPT.toLowerCase())) {
      nextPrompt = nextPrompt ? `${nextPrompt} ${BLINK_HANDJOB_1_PROMPT}` : BLINK_HANDJOB_1_PROMPT
    }
  }
  if (selections.some((selection) => selection.id === BLINK_HANDJOB_2_LORA_ID)) {
    if (!nextPrompt.toLowerCase().includes(BLINK_HANDJOB_2_PROMPT.toLowerCase())) {
      nextPrompt = nextPrompt ? `${nextPrompt} ${BLINK_HANDJOB_2_PROMPT}` : BLINK_HANDJOB_2_PROMPT
    }
  }
  if (selections.some((selection) => selection.id === BLINK_HANDJOB_3_LORA_ID)) {
    if (!nextPrompt.toLowerCase().includes(BLINK_HANDJOB_3_PROMPT.toLowerCase())) {
      nextPrompt = nextPrompt ? `${nextPrompt} ${BLINK_HANDJOB_3_PROMPT}` : BLINK_HANDJOB_3_PROMPT
    }
  }
  if (selections.some((selection) => selection.id === PAIZURI_LORA_ID)) {
    if (!nextPrompt.toLowerCase().includes(PAIZURI_PROMPT.toLowerCase())) {
      nextPrompt = nextPrompt ? `${nextPrompt} ${PAIZURI_PROMPT}` : PAIZURI_PROMPT
    }
  }
  if (selections.some((selection) => selection.id === I2PEE_LORA_ID)) {
    if (!new RegExp(`(^|\\s|,)${I2PEE_PROMPT}(\\s|,|$)`, 'i').test(nextPrompt)) {
      nextPrompt = nextPrompt ? `${nextPrompt} ${I2PEE_PROMPT}` : I2PEE_PROMPT
    }
  }
  if (selections.some((selection) => selection.id === FRONT_DOGGY_1_LORA_ID)) {
    if (!nextPrompt.toLowerCase().includes(FRONT_DOGGY_1_PROMPT.toLowerCase())) {
      nextPrompt = nextPrompt ? `${nextPrompt} ${FRONT_DOGGY_1_PROMPT}` : FRONT_DOGGY_1_PROMPT
    }
  }
  if (selections.some((selection) => selection.id === FRONT_DOGGY_2_LORA_ID)) {
    if (!nextPrompt.toLowerCase().includes(FRONT_DOGGY_2_PROMPT.toLowerCase())) {
      nextPrompt = nextPrompt ? `${nextPrompt} ${FRONT_DOGGY_2_PROMPT}` : FRONT_DOGGY_2_PROMPT
    }
  }
  if (selections.some((selection) => selection.id === FRONT_DOGGY_3_LORA_ID)) {
    if (!nextPrompt.toLowerCase().includes(FRONT_DOGGY_3_PROMPT.toLowerCase())) {
      nextPrompt = nextPrompt ? `${nextPrompt} ${FRONT_DOGGY_3_PROMPT}` : FRONT_DOGGY_3_PROMPT
    }
  }
  if (selections.some((selection) => selection.id === HANDJOB_BLOWJOB_COMBO_LORA_ID)) {
    if (!nextPrompt.toLowerCase().includes(HANDJOB_BLOWJOB_COMBO_PROMPT.toLowerCase())) {
      nextPrompt = nextPrompt ? `${nextPrompt} ${HANDJOB_BLOWJOB_COMBO_PROMPT}` : HANDJOB_BLOWJOB_COMBO_PROMPT
    }
  }
  if (selections.some((selection) => selection.id === BLINK_BLOWJOB_LORA_ID)) {
    if (!nextPrompt.toLowerCase().includes(BLINK_BLOWJOB_PROMPT.toLowerCase())) {
      nextPrompt = nextPrompt ? `${nextPrompt} ${BLINK_BLOWJOB_PROMPT}` : BLINK_BLOWJOB_PROMPT
    }
  }
  if (selections.some((selection) => selection.id === BLINK_MISSIONARY_1_LORA_ID)) {
    if (!nextPrompt.toLowerCase().includes(BLINK_MISSIONARY_1_PROMPT.toLowerCase())) {
      nextPrompt = nextPrompt ? `${nextPrompt} ${BLINK_MISSIONARY_1_PROMPT}` : BLINK_MISSIONARY_1_PROMPT
    }
  }
  if (selections.some((selection) => selection.id === BLINK_MISSIONARY_2_LORA_ID)) {
    if (!nextPrompt.toLowerCase().includes(BLINK_MISSIONARY_2_PROMPT.toLowerCase())) {
      nextPrompt = nextPrompt ? `${nextPrompt} ${BLINK_MISSIONARY_2_PROMPT}` : BLINK_MISSIONARY_2_PROMPT
    }
  }
  if (selections.some((selection) => selection.id === BLINK_MISSIONARY_3_LORA_ID)) {
    if (!nextPrompt.toLowerCase().includes(BLINK_MISSIONARY_3_PROMPT.toLowerCase())) {
      nextPrompt = nextPrompt ? `${nextPrompt} ${BLINK_MISSIONARY_3_PROMPT}` : BLINK_MISSIONARY_3_PROMPT
    }
  }
  if (selections.some((selection) => selection.id === SQUATTING_COWGIRL_1_LORA_ID)) {
    if (!nextPrompt.toLowerCase().includes(SQUATTING_COWGIRL_1_PROMPT.toLowerCase())) {
      nextPrompt = nextPrompt ? `${nextPrompt} ${SQUATTING_COWGIRL_1_PROMPT}` : SQUATTING_COWGIRL_1_PROMPT
    }
  }
  if (selections.some((selection) => selection.id === SQUATTING_COWGIRL_2_LORA_ID)) {
    if (!nextPrompt.toLowerCase().includes(SQUATTING_COWGIRL_2_PROMPT.toLowerCase())) {
      nextPrompt = nextPrompt ? `${nextPrompt} ${SQUATTING_COWGIRL_2_PROMPT}` : SQUATTING_COWGIRL_2_PROMPT
    }
  }
  if (selections.some((selection) => selection.id === SIDELEG_TRANSITION_LORA_ID)) {
    if (!nextPrompt.toLowerCase().includes(SIDELEG_TRANSITION_PROMPT.toLowerCase())) {
      nextPrompt = nextPrompt ? `${nextPrompt} ${SIDELEG_TRANSITION_PROMPT}` : SIDELEG_TRANSITION_PROMPT
    }
  }
  return nextPrompt
}

const applyLoraPackStack = (workflow: Record<string, any>, selections: readonly LoraPackSelection[]) => {
  const highUnetNodeIds: string[] = []
  const lowUnetNodeIds: string[] = []

  for (const [nodeId, node] of Object.entries(workflow)) {
    if (node?.class_type !== 'UNETLoader') continue
    const unetName = String(node?.inputs?.unet_name ?? '').toLowerCase()
    if (!unetName) continue

    if (unetName.includes('fp8h') || unetName.includes('_high') || unetName.includes('high')) {
      highUnetNodeIds.push(String(nodeId))
      continue
    }
    if (unetName.includes('fp8l') || unetName.includes('_low') || unetName.includes('low')) {
      lowUnetNodeIds.push(String(nodeId))
    }
  }

  const highBaseNodeId = highUnetNodeIds[0]
  const lowBaseNodeId = lowUnetNodeIds[0]
  if (!highBaseNodeId || !lowBaseNodeId) return

  const existingLoraNodeIds = Object.entries(workflow)
    .filter(([, node]) => (node as any)?.class_type === 'LoraLoaderModelOnly')
    .map(([id]) => id)
  for (const id of existingLoraNodeIds) {
    delete workflow[id]
  }

  let nextId =
    Math.max(
      ...Object.keys(workflow)
        .map((id) => Number(id))
        .filter((id) => Number.isFinite(id)),
    ) + 1
  if (!Number.isFinite(nextId)) nextId = 1000

  const createChain = (baseNodeId: string, side: 'high' | 'low') => {
    let currentNodeId = baseNodeId
    const loadedLoras = new Set<string>()
    for (const selection of selections) {
      const option = LORA_PACK_OPTIONS[selection.id]
      const loraNames = option[side]
      for (const loraName of loraNames) {
        if (loadedLoras.has(loraName)) continue
        loadedLoras.add(loraName)
        const nodeId = String(nextId++)
        workflow[nodeId] = {
          class_type: 'LoraLoaderModelOnly',
          inputs: {
            model: [currentNodeId, 0],
            lora_name: loraName,
            strength_model: selection.strength,
          },
        }
        currentNodeId = nodeId
      }
    }
    return currentNodeId
  }

  const highFinalNodeId = createChain(highBaseNodeId, 'high')
  const lowFinalNodeId = createChain(lowBaseNodeId, 'low')

  for (const node of Object.values(workflow)) {
    if ((node as any)?.class_type !== 'ModelSamplingSD3') continue
    if (!(node as any)?.inputs) continue

    const modelRef = (node as any).inputs.model
    if (Array.isArray(modelRef) && modelRef.length > 0) {
      const sourceNodeId = String(modelRef[0])
      if (sourceNodeId === highBaseNodeId || sourceNodeId === highFinalNodeId) {
        ;(node as any).inputs.model = [highFinalNodeId, 0]
      } else if (sourceNodeId === lowBaseNodeId || sourceNodeId === lowFinalNodeId) {
        ;(node as any).inputs.model = [lowFinalNodeId, 0]
      }
    }

    ;(node as any).inputs.shift = LORA_PACK_SHIFT
  }
}

export const onRequestOptions: PagesFunction<Env> = async ({ request, env }) => {
  const corsHeaders = buildCorsHeaders(request, env, corsMethods)
  if (isCorsBlocked(request, env)) {
    return new Response(null, { status: 403, headers: corsHeaders })
  }
  return new Response(null, { headers: corsHeaders })
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const corsHeaders = buildCorsHeaders(request, env, corsMethods)
  if (isCorsBlocked(request, env)) {
    return new Response(null, { status: 403, headers: corsHeaders })
  }

  const i2vVariant = resolveI2VVariant(request)
  const isLoraPack = isLoraPackRoute(request)
  const isFreeGuestMode = false
  let authContext: { admin: ReturnType<typeof createClient>; user: User } | null = null
  if (!isFreeGuestMode) {
    const auth = await requireGoogleUser(request, env, corsHeaders)
    if ('response' in auth) {
      return auth.response
    }
    authContext = auth
  }

  const url = new URL(request.url)
  const id = url.searchParams.get('id')
  if (!id) {
    return jsonResponse({ error: ERROR_ID_REQUIRED }, 400, corsHeaders)
  }
  const modeParam = String(url.searchParams.get('mode') ?? '').toLowerCase()
  if (modeParam === 't2v') {
    return jsonResponse({ error: 'mode "t2v" is no longer supported.' }, 400, corsHeaders)
  }
  const statusMode: GenerationMode = modeParam === 'animate' ? 'animate' : 'i2v'
  if (i2vVariant === 'dasiwa' && statusMode !== 'i2v') {
    return jsonResponse({ error: 'wan-dasiwa supports mode "i2v" only.' }, 400, corsHeaders)
  }
  if (isLoraPack && statusMode !== 'i2v') {
    return jsonResponse({ error: 'wan-lora-pack supports mode "i2v" only.' }, 400, corsHeaders)
  }
  if (!env.RUNPOD_API_KEY) {
    return jsonResponse({ error: 'RUNPOD_API_KEY is not set.' }, 500, corsHeaders)
  }

  const endpoint = resolveEndpoint(env, request, statusMode, i2vVariant)
  if (!endpoint) {
    return jsonResponse(
      {
        error:
          'WAN endpoint is not set. Configure RUNPOD_WAN_DASIWA_ENDPOINT_URL or RUNPOD_WAN_RAPID_FASTMOVE_ENDPOINT_URL for i2v and RUNPOD_WAN_ENDPOINT_URL for animate.',
      },
      500,
      corsHeaders,
    )
  }
  const usageId = `wan:${id}`
  let usageTicketMeta: ReturnType<typeof resolveUsageTicketMeta> | null = null
  if (!isFreeGuestMode && authContext) {
    const usageEventResult = await requireOwnedUsageChargeEvent(authContext.admin, authContext.user, usageId, corsHeaders)
    if ('response' in usageEventResult) {
      return usageEventResult.response
    }
    usageTicketMeta = resolveUsageTicketMeta(usageEventResult.event)
  }
  const requestedSecondsRaw = url.searchParams.get('seconds')
  const requestedSeconds = requestedSecondsRaw === null ? null : Math.floor(Number(requestedSecondsRaw))
  const requestedDurationOption =
    requestedSeconds !== null && Number.isFinite(requestedSeconds)
      ? resolveVideoDurationOption(requestedSeconds, i2vVariant, isLoraPack) ?? getDefaultVideoDurationOption(i2vVariant, isLoraPack)
      : getDefaultVideoDurationOption(i2vVariant, isLoraPack)
  const statusDurationOption =
    statusMode === 'animate'
      ? null
      : resolveVideoDurationOption(usageTicketMeta?.seconds ?? requestedDurationOption.seconds, i2vVariant, isLoraPack) ?? requestedDurationOption
  const ticketCost =
    statusMode === 'animate'
      ? DEFAULT_VIDEO_TICKET_COST
      : usageTicketMeta?.ticketCost ?? statusDurationOption.ticketCost

  let upstream: Response
  try {
    upstream = await fetch(`${endpoint}/status/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${env.RUNPOD_API_KEY}` },
    })
  } catch {
    return jsonResponse({ error: INTERNAL_SERVER_ERROR_MESSAGE }, 502, corsHeaders)
  }
  const raw = await upstream.text()
  let payload: any = null
  let ticketsLeft: number | null = null
  try {
    payload = JSON.parse(raw)
  } catch {
    payload = null
  }

  if (!upstream.ok) {
    return jsonResponse({ error: INTERNAL_SERVER_ERROR_MESSAGE }, 502, corsHeaders)
  }

  if (!isFreeGuestMode && authContext && payload && shouldConsumeTicket(payload)) {
    const ticketMeta = {
      job_id: id,
      status: payload?.status ?? payload?.state ?? null,
      source: 'status',
      ticket_cost: ticketCost,
      seconds: statusDurationOption?.seconds ?? null,
    }
    const result = await consumeTicket(authContext.admin, authContext.user, ticketMeta, usageId, ticketCost, corsHeaders)
    if ('response' in result) {
      return result.response
    }
    const nextTickets = Number((result as { ticketsLeft?: unknown }).ticketsLeft)
    if (Number.isFinite(nextTickets)) {
      ticketsLeft = nextTickets
    }
  }

  if (!isFreeGuestMode && authContext && payload && (isFailureStatus(payload) || hasOutputError(payload))) {
    const refundMeta = {
      job_id: id,
      status: payload?.status ?? payload?.state ?? null,
      source: 'status',
      reason: 'failure',
      ticket_cost: ticketCost,
      seconds: statusDurationOption?.seconds ?? null,
    }
    const refundResult = await refundTicket(authContext.admin, authContext.user, refundMeta, usageId, ticketCost, corsHeaders)
    if ('response' in refundResult) {
      return refundResult.response
    }
    const nextTickets = Number((refundResult as { ticketsLeft?: unknown }).ticketsLeft)
    if (Number.isFinite(nextTickets)) {
      ticketsLeft = nextTickets
    }
  }

  if (ticketsLeft !== null && payload && typeof payload === 'object' && !Array.isArray(payload)) {
    payload.ticketsLeft = ticketsLeft
    return jsonResponse(sanitizePayload(payload), upstream.status, corsHeaders)
  }

  if (payload && typeof payload === 'object') {
    return jsonResponse(sanitizePayload(payload), upstream.status, corsHeaders)
  }
  if (!upstream.ok) {
    return jsonResponse({ error: INTERNAL_SERVER_ERROR_MESSAGE }, upstream.status, corsHeaders)
  }

  return new Response(sanitizeText(raw), {
    status: upstream.status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const corsHeaders = buildCorsHeaders(request, env, corsMethods)
  if (isCorsBlocked(request, env)) {
    return new Response(null, { status: 403, headers: corsHeaders })
  }

  const i2vVariant = resolveI2VVariant(request)
  const isLoraPack = isLoraPackRoute(request)
  const isFreeGuestMode = false
  let authContext: { admin: ReturnType<typeof createClient>; user: User } | null = null
  if (!isFreeGuestMode) {
    const auth = await requireGoogleUser(request, env, corsHeaders)
    if ('response' in auth) {
      return auth.response
    }
    authContext = auth
  }

  if (!env.RUNPOD_API_KEY) {
    return jsonResponse({ error: 'RUNPOD_API_KEY is not set.' }, 500, corsHeaders)
  }

  const payload = await request.json().catch(() => null)
  if (!payload) {
    return jsonResponse({ error: 'Invalid request body.' }, 400, corsHeaders)
  }

  const input = payload.input ?? payload
  if (input?.workflow) {
    return jsonResponse({ error: 'workflow overrides are not allowed.' }, 400, corsHeaders)
  }
  const mode = String(input?.mode ?? 'i2v').toLowerCase()
  if (mode === 't2v') {
    return jsonResponse({ error: 'mode "t2v" is no longer supported.' }, 400, corsHeaders)
  }
  if (mode !== 'i2v' && mode !== 'animate') {
    return jsonResponse({ error: 'mode must be "i2v" or "animate".' }, 400, corsHeaders)
  }
  const generationMode = mode as GenerationMode
  if (i2vVariant === 'dasiwa' && generationMode !== 'i2v') {
    return jsonResponse({ error: 'wan-dasiwa supports mode "i2v" only.' }, 400, corsHeaders)
  }
  if (isLoraPack && generationMode !== 'i2v') {
    return jsonResponse({ error: 'wan-lora-pack supports mode "i2v" only.' }, 400, corsHeaders)
  }

  const endpoint = resolveEndpoint(env, request, generationMode, i2vVariant)
  if (!endpoint) {
    return jsonResponse(
      {
        error:
          'WAN endpoint is not set. Configure RUNPOD_WAN_DASIWA_ENDPOINT_URL or RUNPOD_WAN_RAPID_FASTMOVE_ENDPOINT_URL for i2v and RUNPOD_WAN_ENDPOINT_URL for animate.',
      },
      500,
      corsHeaders,
    )
  }
  const isAnimate = mode === 'animate'
  const durationResult = isAnimate
    ? { option: null as null | VideoDurationOption, error: null as string | null }
    : resolveVideoDurationFromInput(input?.seconds, i2vVariant, isLoraPack)
  if (!isAnimate && (durationResult.error || !durationResult.option)) {
    return jsonResponse({ error: durationResult.error ?? 'Invalid seconds value.' }, 400, corsHeaders)
  }
  const videoDurationOption = durationResult.option ?? getDefaultVideoDurationOption(i2vVariant, isLoraPack)
  const imageValue = input?.image_base64 ?? input?.image ?? input?.image_url
  if (!isAnimate && !imageValue) {
    return jsonResponse({ error: ERROR_I2V_IMAGE_REQUIRED }, 400, corsHeaders)
  }
  const videoValue = input?.video_base64 ?? input?.video ?? input?.video_url
  if (isAnimate && !videoValue) {
    return jsonResponse({ error: ERROR_ANIMATE_VIDEO_REQUIRED }, 400, corsHeaders)
  }

  let imageBase64 = ''
  let videoBase64 = ''
  try {
    if (imageValue) {
      if (typeof input?.image_url === 'string' && input.image_url) {
        throw new Error('image_url is not allowed. Use base64.')
      }
      imageBase64 = ensureBase64Input('image', imageValue)
    }
  } catch {
    return jsonResponse(
      { error: ERROR_IMAGE_READ_FAILED },
      400,
      corsHeaders,
    )
  }
  try {
    if (videoValue) {
      if (typeof input?.video_url === 'string' && input.video_url) {
        throw new Error('video_url is not allowed. Use base64.')
      }
      videoBase64 = ensureBase64Input('video', videoValue, MAX_VIDEO_BYTES)
    }
  } catch {
    return jsonResponse(
      { error: ERROR_VIDEO_READ_FAILED },
      400,
      corsHeaders,
    )
  }

  if (!isAnimate && !imageBase64) {
    return jsonResponse({ error: 'image is empty.' }, 400, corsHeaders)
  }
  if (isAnimate && !videoBase64) {
    return jsonResponse({ error: 'video is empty.' }, 400, corsHeaders)
  }

  if (!isAnimate) {
    try {
      if (await isUnderageImage(imageBase64, env)) {
        return jsonResponse({ error: UNDERAGE_BLOCK_MESSAGE }, 400, corsHeaders)
      }
    } catch (error) {
      return jsonResponse(
        { error: INTERNAL_SERVER_ERROR_MESSAGE },
        500,
        corsHeaders,
      )
    }
  }

  let prompt = String(input?.prompt ?? input?.text ?? '')
  const negativePrompt = String(input?.negative_prompt ?? input?.negative ?? '')
  const loraSelectionResult = isLoraPack
    ? parseLoraPackSelections(input?.loras)
    : { selections: [] as LoraPackSelection[], error: null as string | null }
  if (loraSelectionResult.error) {
    return jsonResponse({ error: loraSelectionResult.error }, 400, corsHeaders)
  }
  const loraSelections = loraSelectionResult.selections
  const activeLoraSelections = loraSelections.filter((selection) => selection.strength >= ACTIVE_LORA_PACK_STRENGTH)
  if (
    isLoraPack &&
    authContext &&
    activeLoraSelections.some((selection) => PREMIUM_LORA_PACK_OPTION_IDS.has(selection.id))
  ) {
    const premiumMember = await hasActivePremiumMembership(authContext.admin, authContext.user)
    if (!premiumMember) {
      return jsonResponse({ error: 'Premium membership is required for this LoRA.' }, 403, corsHeaders)
    }
  }
  prompt = withLoraPackTriggers(prompt, activeLoraSelections)
  const steps = isAnimate ? FIXED_STEPS_ANIMATE : isLoraPack ? LORA_PACK_STEPS : FIXED_STEPS
  const cfg = 1
  const width = Math.floor(Number(input?.width ?? 720))
  const height = Math.floor(Number(input?.height ?? 512))
  const fps = isAnimate ? FIXED_FPS_DEFAULT : isLoraPack ? LORA_PACK_FPS : i2vVariant === 'dasiwa' ? FIXED_FPS_DASIWA : FIXED_FPS_DEFAULT
  const numFrames = isAnimate
    ? Math.max(1, Math.floor(Number(input?.num_frames ?? FIXED_ANIMATE_FRAMES)))
    : videoDurationOption.frames
  const seconds = isAnimate ? null : videoDurationOption.seconds
  const ticketCost = isAnimate
    ? DEFAULT_VIDEO_TICKET_COST
    : videoDurationOption.ticketCost
  const seed = input?.randomize_seed
    ? Math.floor(Math.random() * 2147483647)
    : Number(input?.seed ?? 0)

  if (prompt.length > MAX_PROMPT_LENGTH) {
    return jsonResponse({ error: 'Prompt is too long.' }, 400, corsHeaders)
  }
  if (negativePrompt.length > MAX_NEGATIVE_PROMPT_LENGTH) {
    return jsonResponse({ error: 'Negative prompt is too long.' }, 400, corsHeaders)
  }
  if (!Number.isFinite(cfg) || cfg < MIN_CFG || cfg > MAX_CFG) {
    return jsonResponse({ error: `cfg must be between ${MIN_CFG} and ${MAX_CFG}.` }, 400, corsHeaders)
  }
  if (!Number.isFinite(width) || width < MIN_DIMENSION || width > MAX_DIMENSION) {
    return jsonResponse(
      { error: `width must be between ${MIN_DIMENSION} and ${MAX_DIMENSION}.` },
      400,
      corsHeaders,
    )
  }
  if (!Number.isFinite(height) || height < MIN_DIMENSION || height > MAX_DIMENSION) {
    return jsonResponse(
      { error: `height must be between ${MIN_DIMENSION} and ${MAX_DIMENSION}.` },
      400,
      corsHeaders,
    )
  }
  const totalSteps = Math.max(1, Math.floor(steps))
  const splitStep = isLoraPack ? LORA_PACK_SPLIT_STEP : Math.max(1, Math.floor(totalSteps / 2))

  const ticketMeta = {
    prompt_length: prompt.length,
    width,
    height,
    frames: numFrames,
    fps,
    steps: totalSteps,
    mode,
    seconds,
    ticket_cost: ticketCost,
    lora_count: activeLoraSelections.length,
  }
  if (!isFreeGuestMode && authContext) {
    const ticketCheck = await ensureTicketAvailable(authContext.admin, authContext.user, ticketCost, corsHeaders)
    if ('response' in ticketCheck) {
      return ticketCheck.response
    }
  }

  const imageName = String(input?.image_name ?? 'input.png')
  const videoName = String(input?.video_name ?? 'source.mp4')
  const workflow = clone(await getWorkflowTemplate(generationMode, i2vVariant))
  if (!workflow || Object.keys(workflow).length === 0) {
    return jsonResponse({ error: 'wan workflow is empty. Export a ComfyUI API workflow.' }, 500, corsHeaders)
  }

  if (isLoraPackRoute(request)) {
    applyLoraPackStack(workflow as Record<string, any>, activeLoraSelections)
  }

  const nodeMap = await getNodeMap(generationMode).catch(() => null)
  const hasNodeMap = nodeMap && Object.keys(nodeMap).length > 0
  if (!hasNodeMap) {
    return jsonResponse({ error: 'wan node map is empty.' }, 500, corsHeaders)
  }

  const nodeValues: Record<string, unknown> = {
    image: imageBase64 ? imageName : undefined,
    video: videoBase64 ? videoName : undefined,
    prompt,
    negative_prompt: negativePrompt,
    seed,
    steps: totalSteps,
    cfg,
    width,
    height,
    num_frames: numFrames,
    fps,
    end_step: splitStep,
    start_step: splitStep,
  }
  applyNodeMap(workflow as Record<string, any>, nodeMap as NodeMap, nodeValues)

  const comfyKey = String(env.COMFY_ORG_API_KEY ?? '')
  const images = [
    ...(imageBase64 ? [{ name: imageName, image: imageBase64 }] : []),
    ...(videoBase64 ? [{ name: videoName, image: videoBase64 }] : []),
  ]
  const runpodInput: Record<string, unknown> = {
    workflow,
    images,
  }
  if (comfyKey) {
    runpodInput.comfy_org_api_key = comfyKey
  }

  const upstream = await fetch(`${endpoint}/run`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RUNPOD_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ input: runpodInput }),
  })
  const raw = await upstream.text()
  let upstreamPayload: any = null
  let ticketsLeft: number | null = null
  try {
    upstreamPayload = JSON.parse(raw)
  } catch {
    upstreamPayload = null
  }

  const jobId = extractJobId(upstreamPayload)
  const shouldCharge =
    upstream.ok && Boolean(jobId) && !isFailureStatus(upstreamPayload) && !hasOutputError(upstreamPayload)

  if (!isFreeGuestMode && authContext && shouldCharge && jobId) {
    const usageId = `wan:${jobId}`
    const ticketMetaWithJob = {
      ...ticketMeta,
      job_id: jobId,
      status: upstreamPayload?.status ?? upstreamPayload?.state ?? null,
      source: 'run',
    }
    const result = await consumeTicket(authContext.admin, authContext.user, ticketMetaWithJob, usageId, ticketCost, corsHeaders)
    if ('response' in result) {
      return result.response
    }
    const nextTickets = Number((result as { ticketsLeft?: unknown }).ticketsLeft)
    if (Number.isFinite(nextTickets)) {
      ticketsLeft = nextTickets
    }
  } else if (!isFreeGuestMode && authContext && upstreamPayload && shouldConsumeTicket(upstreamPayload)) {
    const jobId = extractJobId(upstreamPayload)
    const usageId = jobId ? `wan:${jobId}` : undefined
    const ticketMetaWithJob = {
      ...ticketMeta,
      job_id: jobId ?? undefined,
      status: upstreamPayload?.status ?? upstreamPayload?.state ?? null,
      source: 'run',
    }
    const result = await consumeTicket(authContext.admin, authContext.user, ticketMetaWithJob, usageId, ticketCost, corsHeaders)
    if ('response' in result) {
      return result.response
    }
    const nextTickets = Number((result as { ticketsLeft?: unknown }).ticketsLeft)
    if (Number.isFinite(nextTickets)) {
      ticketsLeft = nextTickets
    }
  }

  if (ticketsLeft !== null && upstreamPayload && typeof upstreamPayload === 'object' && !Array.isArray(upstreamPayload)) {
    upstreamPayload.ticketsLeft = ticketsLeft
    return jsonResponse(sanitizePayload(upstreamPayload), upstream.status, corsHeaders)
  }

  if (upstreamPayload && typeof upstreamPayload === 'object') {
    return jsonResponse(sanitizePayload(upstreamPayload), upstream.status, corsHeaders)
  }
  if (!upstream.ok) {
    return jsonResponse({ error: INTERNAL_SERVER_ERROR_MESSAGE }, upstream.status, corsHeaders)
  }

  return new Response(sanitizeText(raw), {
    status: upstream.status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
