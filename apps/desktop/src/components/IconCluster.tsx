/**
 * Единый вид группы иконочных кнопок: пилюля дока действий, кластер действий
 * сообщения и всё, что появится дальше. Заводить свою поверхность под каждый
 * кластер нельзя — именно так кнопки над сообщением получили модальный чип с
 * тенью и стали выглядеть чужеродно рядом с плоским доком.
 */
export const ICON_CLUSTER_CLASS =
  "flex items-center gap-0.5 rounded-full bg-background p-0.5 ring-1 ring-border ring-inset";

/** Поверхность даёт кластер, поэтому у кнопки внутри своей заливки нет. */
export const ICON_CLUSTER_BUTTON_CLASS = "rounded-full hover:bg-surface";

/** Кнопки в кластерах над сообщением и в шапке блока кода — одного размера. */
export const ICON_CLUSTER_BUTTON_SIZE_CLASS = "size-6";

/**
 * Непрозрачный чип поверх ленты («↓ Вниз», кластер действий ответа). Без
 * `backdrop-blur`: он пересэмплировал бы подложку на каждом кадре прокрутки
 * в прозрачном frameless-окне, а при почти сплошной заливке не был виден.
 */
export const FLOATING_CHIP_CLASS = "border bg-popover shadow-pop";
