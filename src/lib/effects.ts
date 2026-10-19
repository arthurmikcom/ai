// One-click effects: a photo look (studio and chat) and a camera move (video).
// The prompts are plain words, so users see (and can change) what is asked.

export interface PhotoEffect {
  id: string;
  label: string;
  emoji: string;
  /** What the image model is asked to do with the photo. */
  prompt: string;
}

export const PHOTO_EFFECTS: PhotoEffect[] = [
  { id: "retouch", label: "Ретушь", emoji: "✨", prompt: "Естественная ретушь: ровный тон кожи, без бликов, черты лица без изменений" },
  { id: "enhance", label: "Улучшить качество", emoji: "🔍", prompt: "Улучши качество: больше чёткости и деталей, без шума и артефактов, всё остальное без изменений" },
  { id: "studio", label: "Студийный портрет", emoji: "📸", prompt: "Сделай профессиональный студийный портрет: мягкий студийный свет, нейтральный фон, лицо без изменений" },
  { id: "cinema", label: "Кинокадр", emoji: "🎬", prompt: "Сделай кинокадр: кинематографичный свет и цветокоррекция, лёгкое зерно плёнки, лицо без изменений" },
  { id: "background", label: "Новый фон", emoji: "🏞️", prompt: "Замени фон на красивый естественный пейзаж с мягким светом, человек и его поза без изменений" },
  { id: "business", label: "Деловое фото", emoji: "💼", prompt: "Сделай деловой портрет для резюме: аккуратный деловой вид, светлый нейтральный фон, мягкий свет, лицо без изменений" },
  { id: "anime", label: "Аниме", emoji: "🌸", prompt: "Преврати в аниме-иллюстрацию в стиле японской анимации, сохрани узнаваемость, позу и композицию" },
  { id: "cartoon", label: "3D-мультфильм", emoji: "🧸", prompt: "Преврати в героя 3D-мультфильма, сохрани узнаваемость, позу и композицию" },
  { id: "film", label: "Плёнка 90-х", emoji: "📼", prompt: "Сделай как снимок на плёнку 90-х: тёплые цвета, мягкое зерно, лёгкая вспышка, лицо без изменений" },
  { id: "bw", label: "Чёрно-белое", emoji: "🖤", prompt: "Сделай выразительное чёрно-белое фото с глубоким контрастом, как в журнале, лицо без изменений" },
  { id: "neon", label: "Неон", emoji: "🌃", prompt: "Перенеси в ночной неоновый город: неоновая подсветка, отражения, атмосфера киберпанка, лицо без изменений" },
  { id: "painting", label: "Картина маслом", emoji: "🎨", prompt: "Преврати в картину маслом с видимыми мазками кисти, сохрани узнаваемость и композицию" },
];

export interface CameraMotion {
  id: string;
  label: string;
  emoji: string;
  /** Added to the video prompt (video models follow camera directions best in English). */
  prompt: string;
}

export const CAMERA_MOTIONS: CameraMotion[] = [
  { id: "dolly-in", label: "Наезд", emoji: "🎯", prompt: "slow cinematic dolly-in toward the subject" },
  { id: "dolly-out", label: "Отъезд", emoji: "🔭", prompt: "slow dolly-out revealing the surroundings" },
  { id: "orbit", label: "Облёт 360°", emoji: "🔄", prompt: "the camera smoothly orbits around the subject" },
  { id: "drone", label: "Дрон", emoji: "🚁", prompt: "aerial drone shot gliding over the scene" },
  { id: "crash-zoom", label: "Резкий зум", emoji: "💥", prompt: "fast dramatic crash zoom into the subject" },
  { id: "tracking", label: "Слежение", emoji: "🏃", prompt: "tracking shot following the subject's movement" },
  { id: "handheld", label: "Ручная камера", emoji: "🎥", prompt: "handheld camera with a natural slight shake, documentary feel" },
  { id: "slow-motion", label: "Замедление", emoji: "🐢", prompt: "dramatic slow motion" },
  { id: "static", label: "Статичная", emoji: "📌", prompt: "locked-off static camera, only the subject moves" },
];

/** The video prompt with the chosen camera move. */
export function withCameraMotion(prompt: string, motion: CameraMotion | undefined): string {
  if (!motion) return prompt;
  const text = prompt.trim();
  return text ? `${text.replace(/[.\s]+$/, "")}. Camera: ${motion.prompt}.` : `Camera: ${motion.prompt}.`;
}
