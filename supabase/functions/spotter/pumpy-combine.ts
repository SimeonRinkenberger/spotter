/**
 * A narrow copy operation, not coaching. The caller verifies ownership, existing
 * conversation constraints, allowance and attachment availability. The returned
 * proposal must still be confirmed by the user before anything is written.
 */
export function deterministicCombine(message: string, refs: unknown[], maxContextChars = 60_000) {
  const request = message.trim().replace(/\s+/g, " ");
  if (!/^(?:please )?combine these(?: workouts)?(?:,? please)?[.!?]*$/i.test(request)) return null;
  if (refs.length < 2 || refs.length > 6 || !Number.isFinite(maxContextChars) || maxContextChars < 1) return null;
  const record = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const owned: Record<string, any>[] = [];
  for (const ref of refs) {
    if (!record(ref) || typeof ref.id !== "string" || !uuid.test(ref.id) || !Array.isArray(ref.blocks) || !ref.blocks.length) return null;
    let exercises = 0;
    for (const block of ref.blocks) {
      if (!record(block) || !Array.isArray(block.exercises)) return null;
      for (const exercise of block.exercises) {
        if (!record(exercise) || typeof exercise.name !== "string" || !exercise.name.trim()) return null;
        exercises++;
      }
    }
    if (!exercises) return null;
    owned.push(ref);
  }
  if (new Set(owned.map(ref => ref.id)).size !== owned.length) return null;
  // Refuse the whole request; never slice blocks, exercises, notes or evidence.
  try { if (JSON.stringify(owned).length > maxContextChars) return null; }
  catch { return null; }
  const equipment = new Set<string>(), muscles = new Set<string>();
  const collect = (set: Set<string>, values: unknown) => {
    if (Array.isArray(values)) for (const value of values) if (typeof value === "string" && value.trim()) set.add(value.trim());
  };
  const blocks: any[] = [];
  for (const ref of owned) {
    collect(equipment, ref.equipment);
    collect(muscles, ref.muscle_groups);
    for (let bi = 0; bi < ref.blocks.length; bi++) {
      const block = structuredClone(ref.blocks[bi]);
      for (let ei = 0; ei < block.exercises.length; ei++) {
        const exercise = block.exercises[ei];
        collect(equipment, exercise.equipment);
        collect(muscles, exercise.muscle_groups);
        exercise.source = { workout_id: ref.id, block_index: bi, exercise_index: ei };
      }
      blocks.push(block);
    }
  }
  const categories = new Set(owned.map(ref => ref.category));
  const common = owned[0].category;
  const category = categories.size === 1 && typeof common === "string" && common ? common : "Other";
  const count = blocks.reduce((total, block) => total + block.exercises.length, 0);
  const proposal = {
    kind: "create_workout" as const,
    title: "Combined workout", category, difficulty: null,
    // Video or source-workout durations do not establish combined session length.
    duration_minutes: null, equipment: [...equipment], muscle_groups: [...muscles], blocks,
    summary: `Combine all ${count} exercise entries from ${owned.length} attached workouts, preserving their order and programming.`,
  };
  return JSON.stringify(proposal).length <= maxContextChars ? proposal : null;
}
