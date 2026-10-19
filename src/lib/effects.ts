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
  /** Offered in the chat's video mode too (the studio has them all). */
  featured?: boolean;
  /** What it does, for the studio's gallery. */
  hint?: string;
}

export const CAMERA_MOTIONS: CameraMotion[] = [
  { id: "dolly-in", label: "Наезд", emoji: "🎯", prompt: "slow cinematic dolly-in toward the subject", featured: true, hint: "Камера плавно приближается" },
  { id: "dolly-out", label: "Отъезд", emoji: "🔭", prompt: "slow dolly-out revealing the surroundings", featured: true, hint: "Камера отъезжает и открывает место" },
  { id: "orbit", label: "Облёт 360°", emoji: "🔄", prompt: "the camera smoothly orbits around the subject", featured: true, hint: "Полный круг вокруг героя" },
  { id: "drone", label: "Дрон", emoji: "🚁", prompt: "aerial drone shot gliding over the scene", featured: true, hint: "Плавный пролёт сверху" },
  { id: "crash-zoom", label: "Резкий зум", emoji: "💥", prompt: "fast dramatic crash zoom into the subject", featured: true, hint: "Стремительный зум в лицо" },
  { id: "tracking", label: "Слежение", emoji: "🏃", prompt: "tracking shot following the subject's movement", featured: true, hint: "Камера идёт за героем" },
  { id: "handheld", label: "Ручная камера", emoji: "🎥", prompt: "handheld camera with a natural slight shake, documentary feel", featured: true, hint: "Живое дрожание, как в документалке" },
  { id: "slow-motion", label: "Замедление", emoji: "🐢", prompt: "dramatic slow motion", featured: true, hint: "Эпичная замедленная съёмка" },
  { id: "static", label: "Статичная", emoji: "📌", prompt: "locked-off static camera, only the subject moves", featured: true, hint: "Камера стоит, двигается сцена" },
  { id: "arc", label: "Полукруг", emoji: "🌙", prompt: "the camera arcs 90 degrees around the subject, smooth and steady", hint: "Красивый поворот вокруг героя" },
  { id: "fpv", label: "FPV-полёт", emoji: "🛩️", prompt: "fast FPV drone flight swooping through the scene with dynamic banking turns", hint: "Скоростной пролёт сквозь сцену" },
  { id: "crane-up", label: "Кран вверх", emoji: "🏗️", prompt: "crane shot rising up and over the subject, revealing the wide scene", hint: "Камера поднимается над сценой" },
  { id: "crane-down", label: "Кран вниз", emoji: "⬇️", prompt: "crane shot descending from high above down to the subject", hint: "Спуск сверху к герою" },
  { id: "tilt-up", label: "Взгляд вверх", emoji: "⬆️", prompt: "slow tilt up from the ground to the sky, revealing scale", hint: "От земли — к небу" },
  { id: "whip-pan", label: "Резкая панорама", emoji: "💨", prompt: "fast whip pan with motion blur to the subject", hint: "Рывок камеры в сторону" },
  { id: "bullet-time", label: "Bullet time", emoji: "🕶️", prompt: "bullet time: the moment freezes while the camera circles around the subject", hint: "Время застыло, камера облетает" },
  { id: "dutch", label: "Голландский угол", emoji: "📐", prompt: "dutch angle, the camera slowly rolls to a tilted frame, tense mood", hint: "Наклонённый тревожный кадр" },
  { id: "hero", label: "Герой снизу", emoji: "🦸", prompt: "low-angle hero shot slowly pushing up toward the subject, powerful and epic", hint: "Низкий ракурс, мощный образ" },
  { id: "through", label: "Сквозь объект", emoji: "🪟", prompt: "the camera pushes through a window into the scene in one continuous move", hint: "Влёт в сцену сквозь окно" },
  { id: "snorricam", label: "Камера на герое", emoji: "🎢", prompt: "snorricam: the camera is rigged to the subject, the world moves around them", hint: "Герой в центре, мир кружится" },
  { id: "hyperlapse", label: "Гиперлапс", emoji: "🌆", prompt: "hyperlapse moving forward through the scene, time speeds up", hint: "Движение вперёд в ускоренном времени" },
];

export interface VideoEffect {
  id: string;
  label: string;
  emoji: string;
  /** What happens in the clip (English: video models follow it best). */
  prompt: string;
  hint: string;
}

/** Visual effects for a clip, one click each (Higgsfield's VFX): best on the user's own photo. */
export const VIDEO_EFFECTS: VideoEffect[] = [
  { id: "explosion", label: "Взрыв", emoji: "💥", prompt: "a huge cinematic explosion erupts behind the subject, fire, debris and shockwave, the subject stays calm", hint: "Эпичный взрыв за спиной" },
  { id: "disintegrate", label: "Распад", emoji: "🌫️", prompt: "the subject slowly disintegrates into thousands of glowing particles drifting away in the wind", hint: "Рассыпается в частицы" },
  { id: "fire", label: "Пламя", emoji: "🔥", prompt: "stylized magical flames rise around the subject, glowing embers fill the air, nobody is hurt", hint: "Волшебный огонь вокруг" },
  { id: "freeze", label: "Заморозка", emoji: "🧊", prompt: "frost spreads across everything and the scene freezes into sparkling ice", hint: "Всё покрывается льдом" },
  { id: "levitation", label: "Левитация", emoji: "🪄", prompt: "the subject gently levitates above the ground, clothes and hair floating weightlessly", hint: "Герой парит над землёй" },
  { id: "melt", label: "Плавление", emoji: "🫠", prompt: "surreal effect: the scene slowly melts like wax, dripping downward", hint: "Сюрреалистичное таяние" },
  { id: "earth-zoom", label: "До космоса", emoji: "🌍", prompt: "the camera zooms out continuously from the subject up through the clouds to outer space, showing the whole Earth", hint: "Отдаление до планеты" },
  { id: "portal", label: "Портал", emoji: "🌀", prompt: "a glowing magical portal opens behind the subject, swirling light and energy", hint: "Сияющий портал за спиной" },
  { id: "lightning", label: "Молнии", emoji: "⚡", prompt: "lightning strikes all around, the subject is surrounded by crackling electric energy", hint: "Энергия и разряды" },
  { id: "gold", label: "Золото", emoji: "🏆", prompt: "the subject slowly turns into a polished gold statue, shining in the light", hint: "Превращение в золотую статую" },
  { id: "hologram", label: "Голограмма", emoji: "🛰️", prompt: "the subject becomes a flickering blue sci-fi hologram with scanlines and glitches", hint: "Синее голографическое мерцание" },
  { id: "glitch", label: "Глитч", emoji: "📺", prompt: "digital glitch effect, RGB split, pixel distortion and flicker", hint: "Цифровые помехи" },
  { id: "inflate", label: "Надувание", emoji: "🎈", prompt: "funny effect: the subject inflates like a balloon and floats up into the sky", hint: "Смешно надувается и улетает" },
  { id: "petals", label: "Лепестки", emoji: "🌸", prompt: "a swirl of pink cherry blossom petals flies around the subject in a gentle wind", hint: "Вихрь лепестков сакуры" },
  { id: "snow", label: "Снегопад", emoji: "❄️", prompt: "heavy soft snowfall begins, snowflakes drift slowly through the scene", hint: "Мягкий снег" },
  { id: "rain", label: "Ливень", emoji: "🌧️", prompt: "cinematic heavy rain starts, wet reflections and dramatic mood", hint: "Кинематографичный дождь" },
  { id: "timelapse", label: "День в ночь", emoji: "🌗", prompt: "timelapse: day turns into night, clouds race across the sky, city lights turn on", hint: "Время мчится, день сменяет ночь" },
  { id: "aura", label: "Сила", emoji: "✨", prompt: "a powerful glowing energy aura surrounds the subject, light particles rise upward", hint: "Сияющая аура супергероя" },
];

/** The video prompt with the chosen effect. */
export function withVideoEffect(prompt: string, effect: VideoEffect | undefined): string {
  if (!effect) return prompt;
  const text = prompt.trim();
  return text ? `${text.replace(/[.\s]+$/, "")}. Effect: ${effect.prompt}.` : `Effect: ${effect.prompt}.`;
}

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

/**
 * The brush: what's asked is about the area painted over on the picture. The
 * marked copy goes along as the second photo; the server knows the ask by this start.
 */
export const BRUSH_PREFIX = "В выделенном месте:";

/** Ready asks for the painted area, one click each. */
export const BRUSH_IDEAS: { label: string; emoji: string; prompt: string }[] = [
  { label: "Убрать", emoji: "🧽", prompt: "убери это и естественно дорисуй фон, чтобы не осталось следов" },
  { label: "Другой цвет", emoji: "🎨", prompt: "перекрась в другой красивый цвет, всё остальное без изменений" },
  { label: "Цветы", emoji: "🌸", prompt: "замени на красивые живые цветы" },
  { label: "Шляпа", emoji: "🎩", prompt: "добавь стильную шляпу, по размеру и в том же свете" },
  { label: "Аккуратнее", emoji: "✨", prompt: "сделай это место аккуратнее и красивее, естественно" },
];
