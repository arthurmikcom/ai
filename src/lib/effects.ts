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

export interface ImageStyle {
  id: string;
  label: string;
  emoji: string;
  /** Added to the picture's description (image models follow style words best in English). */
  prompt: string;
}

/** Looks for a new picture, one click each (a photo being edited takes PHOTO_EFFECTS instead). */
export const IMAGE_STYLES: ImageStyle[] = [
  { id: "photo", label: "Фотореализм", emoji: "📷", prompt: "photorealistic, shot on a professional camera, natural light, high detail" },
  { id: "cinema", label: "Кино", emoji: "🎬", prompt: "cinematic film still, dramatic lighting, anamorphic lens, color graded" },
  { id: "anime", label: "Аниме", emoji: "🌸", prompt: "anime illustration, clean line art, vibrant colors, studio quality" },
  { id: "3d", label: "3D", emoji: "🧸", prompt: "3D render in the style of an animated feature film, soft global illumination" },
  { id: "watercolor", label: "Акварель", emoji: "💧", prompt: "delicate watercolor painting on textured paper" },
  { id: "oil", label: "Масло", emoji: "🎨", prompt: "oil painting with visible brush strokes and rich texture" },
  { id: "neon", label: "Неон", emoji: "🌃", prompt: "neon cyberpunk aesthetic, glowing lights at night, reflections" },
  { id: "pixel", label: "Пиксель-арт", emoji: "👾", prompt: "pixel art, 16-bit retro video game style" },
  { id: "minimal", label: "Минимализм", emoji: "◻️", prompt: "minimalist flat design, clean shapes, plenty of negative space" },
  { id: "logo", label: "Логотип", emoji: "🔷", prompt: "professional flat vector logo, simple and memorable, centered on a plain background" },
];

/** The picture's description with the chosen style. */
export function withStyle(prompt: string, style: ImageStyle | undefined): string {
  if (!style) return prompt;
  const text = prompt.trim();
  return text ? `${text.replace(/[.\s]+$/, "")}. Style: ${style.prompt}.` : `Style: ${style.prompt}.`;
}

export interface PhotoshootScene {
  id: string;
  label: string;
  emoji: string;
  /** Where and who the character is drawn as (plain words: users see and can change them). */
  prompt: string;
}

/** «Мой персонаж»: ready scenes for a photoshoot, one click each. */
export const PHOTOSHOOT_SCENES: PhotoshootScene[] = [
  { id: "headshot", label: "Деловой портрет", emoji: "💼", prompt: "Деловой портрет для резюме и LinkedIn: строгий костюм, светлый студийный фон, мягкий свет, уверенная улыбка" },
  { id: "magazine", label: "Обложка журнала", emoji: "📰", prompt: "Модная фотосессия для обложки глянцевого журнала: студийный свет, стильный образ, выразительный взгляд в камеру" },
  { id: "paris", label: "Прогулка в Париже", emoji: "🗼", prompt: "Прогулка по улице Парижа на закате, Эйфелева башня на заднем плане, естественный уличный кадр" },
  { id: "beach", label: "Отпуск у моря", emoji: "🏝️", prompt: "Отпуск на тропическом пляже на закате: лёгкая летняя одежда, бирюзовое море, тёплый свет" },
  { id: "astronaut", label: "Космонавт", emoji: "🚀", prompt: "Космонавт в скафандре на поверхности Луны, Земля в небе, кинематографичный кадр" },
  { id: "hero", label: "Супергерой", emoji: "🦸", prompt: "Супергерой в эффектном костюме в динамичной позе над ночным городом, кинематографичный свет" },
  { id: "fantasy", label: "Фэнтези-воин", emoji: "⚔️", prompt: "Герой фэнтези в узорчатых доспехах в волшебном лесу, эпичный свет, как постер фильма" },
  { id: "noir", label: "Нуар", emoji: "🕵️", prompt: "Детектив в стиле нуар: плащ и шляпа, ночная улица под дождём, контрастный чёрно-белый кадр" },
  { id: "retro", label: "Ретро 80-х", emoji: "📼", prompt: "Снимок в стиле 80-х: яркая одежда той эпохи, неон, плёночное зерно, вспышка" },
  { id: "newyear", label: "Новый год", emoji: "🎄", prompt: "Уютный новогодний портрет у наряженной ёлки, гирлянды, тёплый праздничный свет" },
  { id: "anime", label: "Аниме-герой", emoji: "🌸", prompt: "Герой аниме: иллюстрация в стиле японской анимации, яркие цвета, узнаваемые черты лица" },
  { id: "cartoon", label: "3D-мультфильм", emoji: "🧸", prompt: "Герой 3D-мультфильма в стиле Pixar: выразительный, добрый, узнаваемые черты лица" },
];
