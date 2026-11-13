// Todo 共享元数据：吃喝 / 玩乐 / 住宿 / 许愿分类文案，以及"最早要完成日期升序、未安排排后"的任务排序规则。

import type { TodoCategory } from "./types";

export const TODO_CATEGORY_LABELS: Record<TodoCategory, string> = {
  food: "吃喝",
  play: "玩乐",
  stay: "住宿",
  wish: "许愿",
};

export interface TodoSortable {
  id: number;
  created_at: string;
}

export function compareTodoByDueDate<T extends TodoSortable>(
  left: T,
  right: T,
  dueDateOf: (item: T) => string | null,
): number {
  const leftDate = dueDateOf(left);
  const rightDate = dueDateOf(right);
  if (leftDate && rightDate && leftDate !== rightDate) return leftDate.localeCompare(rightDate);
  if (leftDate && !rightDate) return -1;
  if (!leftDate && rightDate) return 1;
  return left.created_at.localeCompare(right.created_at) || left.id - right.id;
}
