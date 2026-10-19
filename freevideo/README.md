# FreeVideo на своём ПК

[FreeVideo](https://github.com/FlashML-org/FreeVideo) генерирует видео по тексту и картинкам прямо на вашем компьютере, без облака и подписок. Внутри модель MiniMax H3 (VDN-H3) и ComfyUI. Всё работает локально, интернет нужен только для установки.

## Подойдёт ли ваш ПК

| | Минимум | Как проверить |
| --- | --- | --- |
| Видеокарта | NVIDIA **RTX 30-й серии или новее** (RTX 3060, 4060, 5060 и выше), от **8 ГБ** видеопамяти | Диспетчер задач → Производительность → Графический процессор |
| Драйвер NVIDIA | **580 или новее** | NVIDIA App или `nvidia-smi` в терминале |
| Оперативная память | **16 ГБ** (лучше 32 ГБ и больше) | Диспетчер задач → Производительность → Память |
| Диск | от **100 ГБ** свободного места, желательно SSD | Проводник → Этот компьютер |
| Система | Windows 10/11 x64, Linux x86_64 или Mac на Apple silicon | |

Видеокарты AMD и Intel, а также NVIDIA GTX 10/16 и RTX 20 не поддерживаются: FreeVideo нужна вычислительная способность 8.0+ (BF16).

Скорость, по замерам сообщества: 10-секундный ролик 1344×768 RTX 5060 Ti 16 ГБ делает примерно за 8 минут, RTX 4060 Ti 8 ГБ за 10, RTX 5090 за 2. На ноутбуках с 8 ГБ это около 15–20 минут.

## Windows: установка одной командой

Откройте **PowerShell** (Пуск → введите `PowerShell` → Enter) и вставьте:

```powershell
iwr -useb https://raw.githubusercontent.com/arthurmikcom/ai/refs/heads/claude/freevideo-local-setup-ohj5x5/freevideo/install-windows.ps1 -OutFile $env:TEMP\fv.ps1; powershell -NoProfile -ExecutionPolicy Bypass -File $env:TEMP\fv.ps1
```

Скрипт [`install-windows.ps1`](install-windows.ps1) делает следующее:

1. Проверяет видеокарту, драйвер, память и место на дисках и, если чего-то не хватает, пишет, что именно исправить.
2. Скачивает официальный установщик `FreeVideo.exe` из [релизов FreeVideo](https://github.com/FlashML-org/FreeVideo/releases/latest) в папку «Загрузки».
3. Запускает его.

Если репозиторий уже скачан, можно просто дважды щёлкнуть [`install-windows.cmd`](install-windows.cmd).

### Вручную, без скрипта

1. Скачайте [FreeVideo.exe](https://github.com/FlashML-org/FreeVideo/releases/latest/download/FreeVideo.exe) и запустите его. Если появится SmartScreen, нажмите «Подробнее» → «Выполнить в любом случае».
2. Выберите папку для **новой установки ComfyUI** на диске, где больше всего места. Если ComfyUI у вас уже есть, укажите его папку: модели, которые уже скачаны, будут использованы повторно.
3. Нажмите **Install & launch**. Установщик покажет план с объёмом загрузки, скачает Python, ComfyUI и модели (это десятки гигабайт, при обычном интернете от часа и дольше) и откроет ComfyUI в браузере с рабочим пространством FreeVideo.

Чтобы открыть FreeVideo потом, используйте ярлык FreeVideo на рабочем столе или снова запустите `FreeVideo.exe`.

## Первое видео

1. В рабочем пространстве FreeVideo опишите сцену (подробно: кто, где, что происходит, движение камеры). Можно добавить первый и последний кадр или референс-картинку.
2. Для первого раза выберите качество **Light** и длину 5 секунд: так быстрее увидеть результат.
3. Нажмите генерацию. Сначала появится превью в половинном разрешении, и дорабатывать до полного качества можно только понравившиеся варианты.

Первый запуск дольше обычного: FreeVideo подбирает ускорение под вашу видеокарту и компилирует ядра. Потом генерация идёт быстрее.

## Linux

Нужны NVIDIA RTX 30+ и драйвер 580+.

```bash
git clone https://github.com/FlashML-org/FreeVideo.git && cd FreeVideo
./setup.sh
```

Скрипт проверит железо, покажет план, после подтверждения всё установит и откроет FreeVideo в браузере. Потом запускайте его командой `freevideo` (`freevideo status`, `freevideo stop`, `freevideo restart`). На рабочем столе можно вместо этого скачать [AppImage](https://github.com/FlashML-org/FreeVideo/releases/latest/download/FreeVideo-Linux-x86_64.AppImage), выполнить `chmod +x` и запустить. Подробнее в [Linux guide](https://github.com/FlashML-org/FreeVideo/blob/main/docs/Linux.md).

## Mac (Apple silicon, предварительная версия)

Скачайте [FreeVideo-Mac-arm64.dmg](https://github.com/FlashML-org/FreeVideo/releases/latest/download/FreeVideo-Mac-arm64.dmg) и перетащите FreeVideo.app в «Программы». Приложение пока не нотаризовано, поэтому при первом открытии разрешите его по [инструкции](https://github.com/FlashML-org/FreeVideo/blob/main/docs/Mac.md#first-open).

## Если ComfyUI уже стоит

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/FlashML-org/FreeVideo.git
```

Перезапустите ComfyUI и откройте **Workflow → Browse Templates → FreeVideo → FreeVideo-All-in-One**, а остальную настройку сделайте в **Settings** FreeVideo.

## Если что-то не так

- **Скрипт пишет, что драйвер ниже 580.** Обновите драйвер через NVIDIA App или на [nvidia.com/drivers](https://www.nvidia.com/drivers), перезагрузите ПК и запустите команду ещё раз.
- **Модели качаются очень медленно или загрузка обрывается.** Перезапустите установщик: он продолжит с того места, где остановился. Если не помогает, используйте [офлайн-пакеты](https://pan.quark.cn/s/c51235b84618): ZIP-файлы перетаскиваются в окно установщика без распаковки.
- **Не хватает памяти или генерация вылетает.** Закройте браузерные вкладки и игры, выберите Light и меньшую длину ролика.
- **Любая другая ошибка.** Установщик умеет экспортировать отчёт. С ним можно написать в [Issues](https://github.com/FlashML-org/FreeVideo/issues) или [Discord](https://discord.gg/MsA277cJzZ). Есть и [видео-инструкция по установке на русском](https://www.youtube.com/watch?v=YWRwlfcW_qc).

## Лицензия

Код FreeVideo распространяется под Apache 2.0. Веса модели идут под [MiniMax H3 Community License](https://huggingface.co/OpenVDN/vdn-minimax-h3-edge/blob/main/LICENSE), в которой есть территориальные ограничения и ограничения на использование. Прочитайте её до того, как использовать сгенерированные видео, особенно в коммерческих целях.
