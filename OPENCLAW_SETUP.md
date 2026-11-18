# Подключение Life OS MCP к OpenClaw (за 1 минуту)

Этот документ содержит готовую конфигурацию локального `stdio` MCP-сервера **`@life-os/mcp`** (`/root/life-os/packages/mcp/dist/index.js`), настройки суточной памяти сессий (`05:00` МСК) и системный промпт личного бизнес-ассистента с пошаговым онбордингом для подключения к **OpenClaw**.

> **Важно по архитектуре токена Telegram и единому профилю:**
> - Оба доверенных Telegram ID (`<OWNER_TELEGRAM_ID>` и `<SECOND_TELEGRAM_ID>`) работают с **единым профилем Life OS** и видят одинаковую живую картину на `https://life.vector-bd.top`, при этом контекст диалогов разделён по собеседнику (`dmScope: "per-channel-peer"`).
> - Фоновый сервис уведомлений `life-os-notifier` (в `PM2`) отправляет будильники, напоминания о привычках, списании подписок, окнах тренировок, контрольных визитах к врачу, сроках годности запасов и утренние/вечерние/недельные сводки **строго через исходящий HTTP `POST /sendMessage`** и никогда не вызывает `getUpdates` (`0` ошибок `409 Conflict` с OpenClaw).

---

## 1. Быстрая проверка перед подключением

Убедись, что проект собран и файл сервера существует:

```bash
ls -la /root/life-os/packages/mcp/dist/index.js
pm2 status
# В pm2 работают только: life-os-web и life-os-notifier
```

MCP-сервер автоматически и бесшумно подхватывает переменные из локального `/root/life-os/.env` (если они не переданы явно через `env` в конфиге OpenClaw) и никогда не пишет отладочные логи в `stdout`, сохраняя чистоту потока `JSON-RPC 2.0`.

---

## 2. Готовый JSON-блок для конфига OpenClaw (MCP + суточная память сессии 05:00 + 2 Telegram ID)

Все секреты передавай только из локального `/root/life-os/.env` (или системного окружения OpenClaw):

```json
{
  "session": {
    "dmScope": "per-channel-peer",
    "reset": {
      "mode": "daily",
      "atHour": 5
    }
  },
  "channels": {
    "telegram": {
      "botToken": "<TELEGRAM_BOT_TOKEN>",
      "dmPolicy": "allowlist",
      "allowFrom": [
        "<OWNER_TELEGRAM_ID>",
        "<SECOND_TELEGRAM_ID>"
      ]
    }
  },
  "mcpServers": {
    "life-os": {
      "command": "node",
      "args": [
        "/root/life-os/packages/mcp/dist/index.js"
      ],
      "env": {
        "TZ": "Europe/Moscow",
        "NEXT_PUBLIC_SUPABASE_URL": "<ИЗ_/root/life-os/.env>",
        "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY": "<ИЗ_/root/life-os/.env>",
        "OWNER_EMAIL": "<ИЗ_/root/life-os/.env>",
        "OWNER_PASSWORD": "<ИЗ_/root/life-os/.env>",
        "TELEGRAM_BOT_TOKEN": "<TELEGRAM_BOT_TOKEN>",
        "ALLOWED_TELEGRAM_USER_ID": "<OWNER_TELEGRAM_ID>",
        "NOTIFY_TELEGRAM_IDS": "<OWNER_TELEGRAM_ID>,<SECOND_TELEGRAM_ID>"
      }
    }
  }
}
```

### Как работает память диалога (24 часа без потери нити + вечный профиль)
- **`mode: "daily", atHour: 5`**: в течение всех суток (с `05:00` утра до `05:00` следующего утра по МСК) бот помнит 100% контекста переписки без коротких idle-сбросов через 30–60 минут тишины.
- **Долгосрочные знания**: результаты онбординга, имя, стиль общения, договорённости, цели, счета, категории, нормы КБЖУ и предпочтения хранятся напрямую в базе **Supabase** (`manage_telegram_onboarding`, `manage_agreement`, `configure_nutrition_targets`) и в `USER.md` / `MEMORY.md`, поэтому они сохраняются навсегда и после утреннего обновления сессии в `05:00`.

---

## 3. Доступные инструменты `@life-os/mcp` (65 инструментов)

### А. Сводки, задачи, встречи, проекты и будильники (Этап 1 — 19 инструментов)
- `get_day_overview` — полная картина любого дня (`date`, по умолчанию сегодня по МСК): главный фокус, загрузка и буфер дня, встречи по часам, гибкие слоты (`Утро / День / Вечер`), лист «Ожидание», ближайшие будильники в `reminders_queue`, последняя отметка состояния, статус вечерней оценки, баланс `Safe-to-Spend`, сводка КБЖУ (`Съедено / Цель ккал`), меню дня, открытые окна тренировок, прогресс привычек (`habits_summary`) и активных целей (`goals_summary`).
- `get_week_overview` — расписание недели (`Пн–Вс` от `anchor_date`, включая прошлые и будущие недели), загрузка по дням и свободные окна.
- `get_assistant_context` — чтение актуальных настроек личности/промпта, личных договорённостей и параметров дня с сайта `https://life.vector-bd.top/settings`.
- `list_tasks` — нечёткий поиск и фильтрация задач по тексту, дате/диапазону, статусу, проекту, цели (`goal`), тегам и слоту дня.
- `get_waiting_for` — список задач в статусе «Ожидание» (`waiting_on_person`, контекст, контрольная дата `follow_up_at`).
- `check_schedule_conflicts` — проверка пересечений по точному времени (`Europe/Moscow`) и подбор свободных окон.
- `create_task`, `update_task`, `complete_task`, `delete_task` — полное управление задачами и встречами (умные дефолты + 100% полей веб-формы: чеклист `subtasks`, проект, цель `goal`/`goal_id`/`goal_query`, теги, приоритет, точное время, будильники `remind_before_minutes` с дефолтом `[30]`, `telegram_chat_id` конкретного собеседника, повтор, ожидание; поиск по названию/дате без ID).
- `set_day_plan` — главный фокус дня, доступное время, защитный буфер и режим энергии.
- `list_projects`, `create_project`, `update_project`, `delete_project` — полное управление проектами.
- `create_reminder`, `list_reminders`, `cancel_reminder` — точные будильники в `reminders_queue` (*«напомни через 20 минут...»* или ко времени по МСК, с поддержкой адресного `telegram_chat_id`).
- `manage_agreement` — просмотр, добавление и удаление рабочих договорённостей с ассистентом.

### Б. Состояние и вечерний чекин (Этап 1 — 6 инструментов)
- `get_state_summary` — история пульса энергии/настроения/напряжения (`1–10`), средние показатели, вечерние оценки и правила оценки.
- `log_state_checkin`, `update_state_checkin`, `delete_state_checkin` — запись, редактирование и удаление отметок состояния (`1–10`), факторов и заметок.
- `upsert_evening_review`, `delete_evening_review` — сохранение/редактирование единой вечерней раздельной оценки дня (не более одной на дату) или её удаление.

### В. Финансы с нуля, Safe-to-Spend, кредитка, подписки и компенсации (Этап 2 — 12 инструментов)
- `get_finance_overview` — полная финансовая картина месяца: расчёт `Safe-to-Spend`, счета и кредитки, чистая личная аналитика по категориям, ожидающие возврата траты, подписки и долги (корректно работает и на полностью чистой базе с `0` счетов и `0` категорий).
- `record_finance_transactions_batch` — пакетная запись сразу нескольких трат/доходов из одной голосовой фразы (*«такси 680 по работе, обед 1200 пополам с другом и продукты 2450 с карты»*) с автоподбором и автосозданием недостающих категорий.
- `record_finance_transaction` — одиночная запись расхода, дохода, перевода между счетами (`kind: 'transfer'`) или полученной компенсации (`kind: 'reimbursement_in'`) с автосозданием категории при первом упоминании на чистой базе.
- `list_finance_transactions` — история и фильтрация операций по дате, месяцу, счёту, категории, типу, характеру расхода (`personal | work_reimbursable | shared_reimbursable`), статусу возврата и тексту.
- `update_finance_transaction`, `delete_finance_transaction` — исправление или удаление любой операции по текстовому запросу, сумме или дате (без знания ID!) с точным пересчётом балансов счетов.
- `settle_reimbursement` — фиксация возврата за рабочую или общую покупку по тексту/контрагенту без искажения доходов и личных расходов.
- `manage_finance_account`, `set_balance_view_mode` — создание и настройка счетов с нуля (дебетовые, наличные, накопительные, кредитки) и переключение режима баланса (`safe_to_spend | accounts | total`).
- `manage_finance_obligation` — обязательные платежи и подписки (`list | create | update | pay | delete`).
- `manage_finance_debt` — долги и займы (`i_owe` / `owed_to_me`, `list | create | update | pay | delete`).
- `manage_finance_category` — категории трат и доходов (`list | create | bulk_create | update | delete`), включая `bulk_create` для быстрого создания сразу 4–8 персональных категорий во время онбординга, месячные лимиты (`monthly_limit`) и голосовые синонимы (`voice_aliases`).

### Г. Питание v2: дневник КБЖУ, ИИ-норма, сканер штрихкодов, фото тарелки, рецепты, вес и покупки (Этап 3 v2 — 13 инструментов)
- `get_nutrition_overview` — полная сводка питания за выбранный день (`anchor_date`): дневник дня по 4 слотам (`Завтрак / Обед / Ужин / Перекус`), норма КБЖУ (`targets`), вес и 14-дневный тренд, план меню недели, список покупок по отделам и запасы дома.
- `configure_nutrition_targets` — расчёт и сохранение персональной нормы калорий, БЖУ и целевого веса через ИИ (`get | calculate_ai | save | calculate_and_save`).
- `scan_barcode_from_image` — оптический сканер штрихкодов (`EAN-13 / EAN-8 / UPC / QR` через `zxing-wasm`) прямо с файла фото на VPS (`image_path`), `image_base64`, `image_url` или строки `barcode` с поиском в Open Food Facts + базовом словаре продуктов.
- `lookup_food_nutrition` — мгновенный поиск КБЖУ любого продукта или готового блюда по 3-уровневой базе (`food_items_dictionary` -> Open Food Facts -> ИИ-расчёт с кэшированием) с пересчётом на `grams`.
- `estimate_and_stage_meal_from_photo` — расчёт КБЖУ блюда по фото тарелки (`commit: false` для превью и подтверждения, `commit: true` для записи).
- `manage_calorie_log` — дневник питания дня (`list_day | add | add_from_recipe | update | delete`) без ID.
- `manage_recipe` — рецепты (`list | get | create | update | recalculate_all | delete`) с авторасчётом КБЖУ из `ingredients[]`.
- `manage_meal_plan` — план меню и готовка (`list | plan | update | mark_cooked | delete`) со списанием из запасов дома.
- `manage_shopping_list` — умный список покупок (`list | add_items | check_item | generate_from_menu | clear_checked | move_checked_to_pantry | delete`) с вычитанием `pantry_items`.
- `manage_pantry` — домашние запасы продуктов (`list | upsert | adjust | delete` + напоминания `pantry_expiry`).
- `lookup_open_food_facts` — прямой поиск и аудит карточек в Open Food Facts.
- `manage_body_weight` — дневник веса тела, `%` жира и обхвата талии (`list | log | delete`).
- `get_nutrition_and_weight_stats` — сводная динамика КБЖУ и веса (`weight_ma7_kg`, `averages`, `weight_delta_kg`) за `7 / 14 / 30 / 90` дней.

### Д. Здоровье: плавающие окна тренировок и организационная медкарта (Этап 3 — 6 инструментов)
- `get_health_overview` — сводка здоровья: программы, плавающие окна тренировок недели, врачи, записи медкарты и контрольные шаги.
- `manage_workout_program` — тренировочные программы (`list | create | update | schedule_week | delete`).
- `manage_workout_session` — тренировки с гибкими окнами `window_start_date..window_end_date` (`list | schedule | update | complete | delete`).
- `manage_medical_doctor` — справочник врачей и клиник (`list | create | update | delete`).
- `manage_medical_record` — организационная медкарта (`list | get | create | update | delete`) + временные защищённые ссылки `signed_url` на прикреплённые файлы. **Строго организационно — назначения делает только врач!**
- `manage_medical_followup` — контрольные шаги после визита к врачу (`list | add | complete | delete`, `create_linked_task: true`).

### Е. Цели, привычки в 1 тап и кросс-доменная аналитика жизни (Этап 4 — 7 инструментов)
- `get_goals_and_habits` — полная сводка целей (`tasks_linked`, `numeric`, `milestones`, флаг пробуксовки `is_stalled`) и привычек (стрики, выполнение за неделю, 30-дневная стабильность, 21-дневная матрица).
- `manage_goal` — создание, изменение, сдвиг числового прогресса (`update_progress`), пауза, достижение и удаление целей без ID.
- `manage_goal_milestone` — этапы (вехи) цели (`add | toggle | update | delete`).
- `link_task_to_goal` — привязка существующей задачи к цели либо мгновенное создание новой задачи-шага (`create_task_title`) прямо внутри цели.
- `manage_habit` — управление привычками (`list | create | update | archive | unarchive | delete`) с ежедневным `reminder_time` (`ЧЧ:ММ` МСК) и адресным `telegram_chat_id`.
- `log_habit_checkin` — отметка одной или нескольких привычек в 1 тап по названию с пересчётом стрика.
- `get_life_analytics_and_proactive_brief` — единая кросс-доменная аналитика за `7 / 14 / 30` дней + проактивные инсайты `proactiveInsights[]`.

### Ж. Пошаговый Telegram-онбординг и живая отправка несколькими сообщениями (2 инструмента)
- `manage_telegram_onboarding` — хранение и обновление прогресса 5-шагового знакомства в Supabase (`get | update_step | complete | reset`), плюс прямое сохранение `display_name`, `tone_guidelines`, `morning_digest_time`, `evening_review_time` и `daily_buffer_minutes`.
- `send_telegram_messages_sequence` — отправка серии из `2–5` коротких отдельных сообщений подряд с живым индикатором набора текста (`typing` + пауза `~450 мс`) строго через исходящий `POST /sendMessage` (после вызова агент возвращает `NO_REPLY`, чтобы не дублировать текст).

---

## 4. Готовый системный промпт для OpenClaw («Напарник» + пошаговый онбординг в несколько сообщений)

Скопируй и вставь этот системный промпт в настройки агента OpenClaw:

```markdown
Ты — живой, умный личный ассистент и операционный напарник в персональной «Системе жизни» (Life OS).
Мы общаемся на «ты»: тепло, легко, структурно и по делу — строго без канцелярита, занудства и длинных простыней текста.

### 1. Пошаговый онбординг нового собеседника (НЕ одним сообщением, а несколькими короткими!)
- При `/start` или первом сообщении от `<SECOND_TELEGRAM_ID>` (либо если `manage_telegram_onboarding(action="get", telegram_user_id="<SECOND_TELEGRAM_ID>")` показывает `status !== "completed"`):
- **ГЛАВНОЕ ПРАВИЛО**: никогда не вываливай все вопросы анкеты одним длинным сообщением! Используй `send_telegram_messages_sequence(chat_id=..., messages=[...])`, чтобы отправлять по **2–3 коротких живых облачка подряд** (после успешного вызова `send_telegram_messages_sequence` завершай ход маркером `NO_REPLY`, чтобы не продублировать текст), и веди настройку диалогом по 5 коротким шагам, сразу сохраняя ответы в базу:
  1. **Шаг 1 (`step1_intro` — Знакомство и ритм)**: тепло поприветствуй (сообщение 1), в двух строках объясни, что ты помогаешь держать в порядке дела, деньги, питание, здоровье и цели без перегруза (сообщение 2), и спроси только первое: как к тебе обращаться, чем сейчас занимаешься и какой тон общения + время утренней/вечерней сводки комфортны (сообщение 3). Ответ сразу сохрани через `manage_telegram_onboarding(action="update_step", current_step=2, completed_step="step1_intro", display_name=..., tone_guidelines=..., morning_digest_time=..., evening_review_time=..., answers=...)`.
  2. **Шаг 2 (`step2_spheres_finance` — Фокусы и финансы с нуля)**: спроси, какие сферы жизни сейчас главные и какие базовые счета (например, основная карта, наличные, накопительный) и 4–6 категорий трат создать. Сразу создай их через `manage_finance_account` и `manage_finance_category(action="bulk_create", categories=[...])`, затем обнови шаг `current_step=3`.
  3. **Шаг 3 (`step3_goals_tasks_habits` — Цели, первые дела и привычки)**: узнай 1–3 главные цели на ближайший период, пару актуальных задач в план и 2–4 простые привычки в 1 тап -> сразу создай их через `manage_goal`, `create_task(..., telegram_chat_id=...)` и `manage_habit(..., telegram_chat_id=...)`, обнови шаг `current_step=4`.
  4. **Шаг 4 (`step4_nutrition` — Питание и норма КБЖУ с ИИ)**: уточни цель по питанию и параметры (пол, возраст, рост, вес, активность, пищевые предпочтения/ограничения) -> рассчитай и сохрани норму через `configure_nutrition_targets(action="calculate_and_save", ...)` + `manage_body_weight` + сохрани предпочтения через `manage_agreement`, обнови шаг `current_step=5`.
  5. **Шаг 5 (`step5_done` — Финал)**: вызови `manage_telegram_onboarding(action="complete", ...)` и в 2–3 коротких сообщениях покажи, как удобно писать/диктовать задачи и траты голосом, присылать фото штрихкодов или тарелки еды, ставить будильники и открывать дашборд `https://life.vector-bd.top`.

### 2. Честность работы с базой и часовой пояс
- Все даты и время интерпретируй строго в `Europe/Moscow` (МСК).
- НИКОГДА не пиши, что записал задачу, трату, счёт, категорию, еду, вес, привычку или будильник, пока реально не вызвал соответствующий MCP-инструмент `life-os` и не получил подтверждение.
- При создании будильников и задач со временем всегда передавай `telegram_chat_id` текущего собеседника, чтобы уведомление пришло именно ему в личку.

### 3. Финансы, питание по фото, тренировки и цели
- **Финансы**: распознавай одиночные и пакетные голосовые траты (`record_finance_transaction` / `record_finance_transactions_batch`), отделяя рабочие (`work_reimbursable`) и общие (`shared_reimbursable`) траты от личной аналитики. Если счетов ещё `0` — предложи за секунду создать основной счёт.
- **Фото штрихкода**: сразу вызывай `scan_barcode_from_image(image_path=...)`. **Фото готовой еды**: оцени блюда и граммовку на тарелке -> вызови `estimate_and_stage_meal_from_photo(..., commit=false)` -> покажи `ккал / Б / Ж / У` и спроси подтверждение перед записью.
- **Здоровье и цели**: тренировки веди гибкими плавающими окнами (`manage_workout_session`), медкарту — строго организационно (назначения делает только врач), а провисшие цели (`is_stalled`) помогай разблокировать одним маленьким шагом через `link_task_to_goal`.
```
