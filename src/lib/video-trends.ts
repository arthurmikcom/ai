// Ready-made trends for «Видео» (like Lexy's): one photo of the user and a
// template — the scene, an effect, a camera move — become a short vertical
// clip, with no prompt to tune.

export type TrendCategory = "women" | "men" | "couple" | "birthday" | "dance" | "pets";

export interface VideoTrend {
  id: string;
  title: string;
  /** One line under the title. */
  hint: string;
  category: TrendCategory;
  /** On the «ХИТ» list. */
  hit?: boolean;
  /** What the video model is told (the user's photo is the first frame). */
  prompt: string;
  effect?: string;
  camera?: string;
}

export const TREND_CATEGORIES: { id: TrendCategory | "all" | "hit"; label: string }[] = [
  { id: "all", label: "Все" },
  { id: "hit", label: "Хиты" },
  { id: "women", label: "Женщины" },
  { id: "men", label: "Мужчины" },
  { id: "couple", label: "Пара" },
  { id: "birthday", label: "День рождения" },
  { id: "dance", label: "Танцы" },
  { id: "pets", label: "Питомцы" },
];

export const VIDEO_TRENDS: VideoTrend[] = [
  {
    id: "angel-wings",
    title: "Ангельские крылья",
    hint: "Белые крылья раскрываются за спиной",
    category: "women",
    hit: true,
    prompt: "large white feathered angel wings slowly unfold behind the person, warm vanity-mirror bulbs glow around, a soft confident smile to the camera, dreamy cinematic light",
    effect: "aura",
    camera: "dolly-in",
  },
  {
    id: "night-drive",
    title: "Ночная поездка",
    hint: "За рулём, огни города на лице",
    category: "women",
    hit: true,
    prompt: "the person drives a car at night, city lights glide across the face and the windshield, calm confident glance to the side, cinematic reflections",
    camera: "tracking",
  },
  {
    id: "stage-dance",
    title: "Танец на сцене",
    hint: "Свет, дым и толпа с телефонами",
    category: "dance",
    hit: true,
    prompt: "the person dances energetically on a concert stage, warm stage lights and haze, a crowd raising phones in the foreground",
    camera: "handheld",
  },
  {
    id: "rain-walk",
    title: "Под дождём",
    hint: "Медленная прогулка в ливень",
    category: "women",
    prompt: "the person walks slowly through the rain under a black umbrella, wet street reflections, moody cinematic atmosphere",
    effect: "rain",
    camera: "tracking",
  },
  {
    id: "first-snow",
    title: "Первый снег",
    hint: "Снежинки падают, улыбка в камеру",
    category: "women",
    prompt: "big soft snowflakes fall around the person, they look up and smile, warm breath in the cold air, winter evening lights",
    effect: "snow",
    camera: "slow-motion",
  },
  {
    id: "superhero",
    title: "Супергерой",
    hint: "Сила, плащ и город за спиной",
    category: "men",
    hit: true,
    prompt: "the person stands as a superhero, a cape flutters in the wind, glowing energy gathers in the hands, city skyline behind, heroic low angle",
    effect: "aura",
    camera: "hero",
  },
  {
    id: "knight",
    title: "Рыцарь",
    hint: "Сияющие доспехи и меч",
    category: "men",
    prompt: "the person stands in shining knight armor holding a long sword, wind moves the cloak, dramatic clouds, epic fantasy film",
    camera: "crane-up",
  },
  {
    id: "fire-power",
    title: "Огненная сила",
    hint: "Пламя поднимается вокруг",
    category: "men",
    prompt: "stylized magical flames rise around the person, glowing embers fly, intense look into the camera, nobody is hurt",
    effect: "fire",
  },
  {
    id: "levitation",
    title: "Левитация",
    hint: "Медленно взлетает над землёй",
    category: "women",
    hit: true,
    prompt: "the person slowly levitates above the ground, hair and clothes float weightlessly, calm magical atmosphere",
    effect: "levitation",
  },
  {
    id: "particles",
    title: "Распад на частицы",
    hint: "Рассыпается светящейся пылью",
    category: "men",
    hit: true,
    prompt: "the person slowly turns into thousands of glowing particles drifting away in the wind",
    effect: "disintegrate",
  },
  {
    id: "portal",
    title: "Портал",
    hint: "Светящийся портал за спиной",
    category: "men",
    prompt: "a glowing swirling portal opens behind the person, light spills out, the person turns towards it",
    effect: "portal",
    camera: "dolly-out",
  },
  {
    id: "golden",
    title: "Золото",
    hint: "Превращается в золотую статую",
    category: "women",
    prompt: "the person slowly turns into a polished gold statue, the shine spreads from the hands to the face",
    effect: "gold",
  },
  {
    id: "birthday-balloons",
    title: "Шары и конфетти",
    hint: "Праздник вокруг вас",
    category: "birthday",
    hit: true,
    prompt: "golden balloons float up and colorful confetti falls around the person, they laugh and celebrate a birthday, warm party lights",
    effect: "petals",
  },
  {
    id: "birthday-cake",
    title: "Торт со свечами",
    hint: "Загадать желание и задуть свечи",
    category: "birthday",
    prompt: "the person holds a birthday cake with lit candles, makes a wish and blows them out, friends cheer off-screen, cozy evening",
    camera: "dolly-in",
  },
  {
    id: "couple-dance",
    title: "Танец пары",
    hint: "Медленный танец под гирляндами",
    category: "couple",
    hit: true,
    prompt: "the couple slowly dances together under warm string lights, romantic evening, gentle smiles",
    camera: "orbit",
  },
  {
    id: "couple-sunset",
    title: "Закат вдвоём",
    hint: "Прогулка у моря за руку",
    category: "couple",
    prompt: "the couple walks hand in hand along the beach at sunset, waves roll in, golden light",
    camera: "tracking",
  },
  {
    id: "club-dance",
    title: "Неоновый клуб",
    hint: "Танец в синем неоне",
    category: "dance",
    prompt: "the person dances in a club full of blue neon light, smooth confident moves, light beams cut through haze",
    camera: "arc",
  },
  {
    id: "freeze-dance",
    title: "Замри",
    hint: "Танец и стоп-кадр с инеем",
    category: "dance",
    prompt: "the person dances, then freezes mid-move as frost spreads over the body",
    effect: "freeze",
  },
  {
    id: "pet-hero",
    title: "Питомец-супергерой",
    hint: "Ваш кот или пёс в плаще",
    category: "pets",
    hit: true,
    prompt: "the pet wears a small red superhero cape that flutters in the wind, it looks proudly at the camera, city skyline behind",
    camera: "hero",
  },
  {
    id: "pet-space",
    title: "Питомец в космосе",
    hint: "Летает среди звёзд",
    category: "pets",
    prompt: "the pet floats in a tiny space suit among stars and planets, weightless and curious",
    effect: "levitation",
  },
];
