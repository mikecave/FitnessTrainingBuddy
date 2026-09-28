import { useEffect, useState } from 'react';
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  addExerciseToTemplate,
  addMemberToGroup,
  createExercise,
  exerciseMap,
  getTemplate,
  moveGroupInTemplate,
  removeMemberFromTemplate,
  renameTemplate,
  setTemplateGroup,
  splitMemberFromGroup,
  updateExercise,
  updateMemberInTemplate,
} from '../data/repo';
import type { Exercise, Section, Template } from '../data/types';
import { formatSets } from '../lib/format';
import { isByFeel } from '../lib/logging';
import AddExercise, { buildPlannedSets, type AddExerciseResult } from '../components/AddExercise';
import { GROUPS, groupOf } from '../lib/templateGroups';
import MemberEditor, { type MemberEditorResult } from '../components/MemberEditor';

const SECTION_LABELS: Record<Section['kind'], string> = {
  warmup: 'Warm-up',
  primary: 'Primary',
  secondary: 'Secondary',
  cooldown: 'Cool-down',
};

const DEFAULT_REST_SEC = 60;

type Path = { si: number; gi: number; mi: number };

/** Group card that becomes draggable (via its ⠿ handle) in edit mode. */
function SortableGroupCard({
  id,
  editing,
  children,
}: {
  id: string;
  editing: boolean;
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled: !editing,
  });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`rounded-xl bg-slate-900 p-4 ${isDragging ? 'z-10 opacity-80 ring-1 ring-sky-500' : ''}`}
    >
      <div className="flex gap-3">
        {editing && (
          <button
            {...attributes}
            {...listeners}
            aria-label="Drag to reorder"
            className="shrink-0 cursor-grab touch-none self-center px-1 text-xl text-slate-500 active:cursor-grabbing"
          >
            ⠿
          </button>
        )}
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}

export default function TemplateView({
  id,
  onBack,
  initialEditing = false,
}: {
  id: string;
  onBack: () => void;
  initialEditing?: boolean;
}) {
  const [template, setTemplate] = useState<Template | null>(null);
  const [exercises, setExercises] = useState<Map<string, Exercise>>(new Map());
  const [editing, setEditing] = useState(initialEditing);
  const [adding, setAdding] = useState(false);
  const [editingPath, setEditingPath] = useState<Path | null>(null);
  const [addingToGroup, setAddingToGroup] = useState<{ si: number; gi: number } | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  function reload() {
    getTemplate(id).then((t) => setTemplate(t ?? null));
  }

  useEffect(() => {
    reload();
    exerciseMap().then(setExercises);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!template) return null;

  const isEmpty = template.sections.every((s) => s.groups.length === 0);

  async function handleAdd(result: AddExerciseResult) {
    const exercise =
      result.existing ??
      (await createExercise({
        name: result.name,
        category: result.category,
        unilateral: result.unilateral,
      }));
    setExercises(new Map(exercises).set(exercise.id, exercise));

    await addExerciseToTemplate(id, result.sectionKind, {
      exerciseId: exercise.id,
      restAfterSec: DEFAULT_REST_SEC,
      sets: buildPlannedSets(result),
    });
    setAdding(false);
    reload();
  }

  async function handleRemove(si: number, gi: number, mi: number) {
    await removeMemberFromTemplate(id, si, gi, mi);
    setEditingPath(null);
    reload();
  }

  async function handleAddToGroup(pos: { si: number; gi: number }, result: AddExerciseResult) {
    const exercise =
      result.existing ??
      (await createExercise({
        name: result.name,
        category: result.category,
        unilateral: result.unilateral,
      }));
    setExercises(new Map(exercises).set(exercise.id, exercise));

    await addMemberToGroup(id, pos.si, pos.gi, {
      exerciseId: exercise.id,
      restAfterSec: DEFAULT_REST_SEC,
      sets: buildPlannedSets(result),
    });
    setAddingToGroup(null);
    reload();
  }

  async function handleUnpair(si: number, gi: number, mi: number) {
    await splitMemberFromGroup(id, si, gi, mi);
    setEditingPath(null);
    reload();
  }

  async function persistMember(path: Path, result: MemberEditorResult) {
    const exercise = exercises.get(result.member.exerciseId);
    if (exercise && result.name !== exercise.name) {
      await updateExercise(exercise.id, { name: result.name });
      const fresh = await exerciseMap();
      setExercises(fresh);
    }
    await updateMemberInTemplate(id, path.si, path.gi, path.mi, result.member);
    reload();
  }

  async function handleSaveMember(path: Path, result: MemberEditorResult) {
    await persistMember(path, result);
    setEditingPath(null);
  }

  function handleDragEnd(si: number, event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id || !template) return;
    const from = Number(String(active.id).slice(1));
    const to = Number(String(over.id).slice(1));
    // optimistic local reorder so the card doesn't snap back while we persist
    setTemplate({
      ...template,
      sections: template.sections.map((s, i) =>
        i === si ? { ...s, groups: arrayMove(s.groups, from, to) } : s,
      ),
    });
    setEditingPath(null);
    setAddingToGroup(null);
    void moveGroupInTemplate(id, si, from, to);
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <button onClick={onBack} className="text-sm text-sky-400">
          ← Workouts
        </button>
        <button
          onClick={() => {
            setEditing(!editing);
            setAdding(false);
            setEditingPath(null);
            setAddingToGroup(null);
          }}
          className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${
            editing ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-300'
          }`}
        >
          {editing ? 'Done' : 'Edit'}
        </button>
      </div>
      {editing ? (
        <div className="mb-1">
          <input
            id="template-name"
            key={template.name}
            defaultValue={template.name}
            aria-label="Workout name"
            onBlur={async (e) => {
              const trimmed = e.target.value.trim();
              if (!trimmed) {
                e.target.value = template.name;
                return;
              }
              await renameTemplate(id, trimmed);
              reload();
            }}
            className="w-full rounded-lg bg-slate-800 px-3 py-2 text-2xl font-bold"
          />
          <div className="mt-1 text-xs text-slate-500">Tap the name to rename ✎</div>
          {template.kind !== 'cardio' && (
            <div className="mt-3 flex items-center gap-2">
              <span className="text-xs uppercase tracking-wide text-slate-500">Home tab</span>
              <div className="flex gap-1" role="group" aria-label="Home tab">
                {GROUPS.map((g) => {
                  const selected = groupOf(template) === g.value;
                  return (
                    <button
                      key={g.value}
                      aria-pressed={selected}
                      onClick={async () => {
                        if (selected) return;
                        await setTemplateGroup(id, g.value);
                        reload();
                      }}
                      className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${
                        selected ? 'bg-sky-500/20 text-sky-300' : 'bg-slate-800 text-slate-500 active:bg-slate-700'
                      }`}
                    >
                      {g.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      ) : (
        <h1 className="mb-1 text-2xl font-bold">{template.name}</h1>
      )}
      {template.timeCapMin && (
        <p className="mb-4 text-sm text-amber-300">Max {template.timeCapMin} min total</p>
      )}

      {isEmpty && !editing && (
        <p className="mt-6 text-sm text-slate-500">
          No exercises yet — tap Edit to build this workout.
        </p>
      )}

      {template.sections.map((section, si) => (
        <section key={si} className="mt-6">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-widest text-slate-400">
            {SECTION_LABELS[section.kind]}
          </h2>
          {section.description && (
            <p className="mb-2 text-sm text-slate-300">{section.description}</p>
          )}
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={(e) => handleDragEnd(si, e)}
          >
            <SortableContext
              items={section.groups.map((_, gi) => `g${gi}`)}
              strategy={verticalListSortingStrategy}
            >
              <div className="flex flex-col gap-3">
                {section.groups.map((group, gi) => (
                  <SortableGroupCard key={gi} id={`g${gi}`} editing={editing}>
                    {group.members.length > 1 && (
                      <div className="mb-2 text-xs font-medium uppercase tracking-wide text-violet-300">
                        Superset
                      </div>
                    )}
                    {group.members.map((m, mi) => {
                      const exercise = exercises.get(m.exerciseId);
                      if (!exercise) return null;
                      const intensity = m.intensity ?? exercise.defaultIntensity;
                      const isEditingThis =
                        editingPath?.si === si && editingPath.gi === gi && editingPath.mi === mi;

                      if (isEditingThis) {
                        return (
                          <div key={mi} className={mi > 0 ? 'mt-3 border-t border-slate-800 pt-3' : ''}>
                            <MemberEditor
                              exercise={exercise}
                              member={m}
                              showIntensity={!isByFeel(section, m)}
                              sectionByFeel={section.logging === 'loose'}
                              onCancel={() => setEditingPath(null)}
                              onSave={(result) => handleSaveMember({ si, gi, mi }, result)}
                              onAutoSave={(result) => void persistMember({ si, gi, mi }, result)}
                            />
                          </div>
                        );
                      }

                      return (
                        <div key={mi} className={mi > 0 ? 'mt-3 border-t border-slate-800 pt-3' : ''}>
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="font-semibold">{exercise.name}</span>
                            <span className="flex shrink-0 flex-wrap items-baseline justify-end gap-2">
                              {!isByFeel(section, m) && (
                                <span className="text-sm text-slate-400">{intensity}/10</span>
                              )}
                              {editing && (
                                <>
                                  <button
                                    onClick={() => setEditingPath({ si, gi, mi })}
                                    aria-label={`Edit ${exercise.name}`}
                                    className="rounded bg-sky-500/15 px-2 py-0.5 text-xs font-semibold text-sky-300 active:bg-sky-500/30"
                                  >
                                    ✎ edit
                                  </button>
                                  {group.members.length > 1 && (
                                    <button
                                      onClick={() => handleUnpair(si, gi, mi)}
                                      aria-label={`Unpair ${exercise.name}`}
                                      className="rounded bg-violet-500/15 px-2 py-0.5 text-xs font-semibold text-violet-300 active:bg-violet-500/30"
                                    >
                                      ⇣ unpair
                                    </button>
                                  )}
                                  <button
                                    onClick={() => handleRemove(si, gi, mi)}
                                    aria-label={`Remove ${exercise.name}`}
                                    className="rounded bg-rose-500/15 px-2 py-0.5 text-xs font-semibold text-rose-300 active:bg-rose-500/30"
                                  >
                                    ✕ remove
                                  </button>
                                </>
                              )}
                            </span>
                          </div>
                          {(exercise.unilateral || exercise.stickyModifier || m.variationNote) && (
                            <div className="text-xs text-slate-500">
                              {[
                                exercise.unilateral ? 'single-side' : null,
                                exercise.stickyModifier,
                                m.variationNote,
                              ]
                                .filter(Boolean)
                                .join(' · ')}
                            </div>
                          )}
                          <div className="mt-1 text-sm text-slate-300">
                            {isByFeel(section, m) ? 'by feel' : formatSets(m.sets, exercise.unilateral)}
                          </div>
                          {!isByFeel(section, m) && (
                            <div className="mt-0.5 text-xs text-slate-500">rest {m.restAfterSec}s</div>
                          )}
                        </div>
                      );
                    })}
                    {editing &&
                      (addingToGroup?.si === si && addingToGroup.gi === gi ? (
                        <div className="mt-3 border-t border-slate-800 pt-3">
                          <AddExercise
                            title="Pair exercise (superset)"
                            fixedSectionKind={section.kind}
                            submitLabel="Add to superset"
                            onCancel={() => setAddingToGroup(null)}
                            onAdd={(result) => handleAddToGroup({ si, gi }, result)}
                          />
                        </div>
                      ) : (
                        <button
                          onClick={() => {
                            setAddingToGroup({ si, gi });
                            setAdding(false);
                            setEditingPath(null);
                          }}
                          className="mt-3 w-full rounded-lg border border-dashed border-violet-500/40 py-2 text-xs font-medium text-violet-300 active:bg-violet-500/10"
                        >
                          ＋ pair exercise (superset)
                        </button>
                      ))}
                  </SortableGroupCard>
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </section>
      ))}

      {editing && (
        <div className="mt-6">
          {adding ? (
            <AddExercise onCancel={() => setAdding(false)} onAdd={handleAdd} />
          ) : (
            <button
              onClick={() => setAdding(true)}
              className="w-full rounded-xl border border-dashed border-slate-700 py-3 text-sm font-medium text-slate-400 active:bg-slate-900"
            >
              ＋ Add exercise
            </button>
          )}
        </div>
      )}
    </div>
  );
}
