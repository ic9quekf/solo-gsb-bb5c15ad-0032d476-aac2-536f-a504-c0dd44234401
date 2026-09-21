import { useState } from 'react';
import { api } from '../api';
import type { Entity, EntityKind, Field } from '../types';

interface Props {
  entities: Entity[];
  onChange: () => Promise<void>;
  notify: (msg: string) => void;
}

export default function EntitiesView({ entities, onChange, notify }: Props) {
  const [kind, setKind] = useState<EntityKind>('character');
  const [newName, setNewName] = useState('');
  const [adding, setAdding] = useState(false);

  async function addEntity() {
    const name = newName.trim();
    if (!name) return;
    setAdding(true);
    try {
      await api.createEntity({ kind, name });
      setNewName('');
      await onChange();
      notify(`已创建${kind === 'character' ? '角色' : '道具'}「${name}」`);
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setAdding(false);
    }
  }

  async function removeEntity(entity: Entity) {
    if (
      !confirm(
        `删除「${entity.name}」将同时删除其全部字段、快照与变更，确定继续？`
      )
    )
      return;
    try {
      await api.deleteEntity(entity.id);
      await onChange();
      notify('已删除对象');
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="view">
      <section className="panel">
        <h2>对象与状态字段</h2>
        <p className="muted">
          对象为<b>角色</b>或<b>道具</b>；每个对象可建立多个状态字段（服装、伤情、道具开合…），
          字段的默认值即故事开始前的初始状态。
        </p>
        <div className="inline-form">
          <select value={kind} onChange={(e) => setKind(e.target.value as EntityKind)}>
            <option value="character">角色</option>
            <option value="prop">道具</option>
          </select>
          <input
            placeholder="对象名称，如：林夏 / 公文包"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addEntity()}
          />
          <button disabled={adding || !newName.trim()} onClick={addEntity}>
            新建对象
          </button>
        </div>
      </section>

      <div className="entity-grid">
        {entities.map((entity) => (
          <EntityCard
            key={entity.id}
            entity={entity}
            onChange={onChange}
            notify={notify}
            onDelete={() => removeEntity(entity)}
          />
        ))}
        {entities.length === 0 && (
          <div className="empty">还没有对象，先在上方创建一个角色或道具。</div>
        )}
      </div>
    </div>
  );
}

function EntityCard({
  entity,
  onChange,
  notify,
  onDelete,
}: {
  entity: Entity;
  onChange: () => Promise<void>;
  notify: (msg: string) => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(entity.name);
  const [newField, setNewField] = useState('');
  const [newDefault, setNewDefault] = useState('');

  async function saveName() {
    const trimmed = name.trim();
    if (!trimmed || trimmed === entity.name) {
      setName(entity.name);
      return;
    }
    try {
      await api.updateEntity(entity.id, { name: trimmed });
      await onChange();
      notify('对象已改名');
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
      setName(entity.name);
    }
  }

  async function addField() {
    const fieldName = newField.trim();
    if (!fieldName) return;
    try {
      await api.addField(entity.id, { name: fieldName, defaultVal: newDefault });
      setNewField('');
      setNewDefault('');
      await onChange();
      notify(`已添加字段「${fieldName}」`);
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <section className="panel entity-card">
      <div className="entity-head">
        <span className={`kind-tag ${entity.kind}`}>
          {entity.kind === 'character' ? '角色' : '道具'}
        </span>
        <input
          className="entity-name-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={saveName}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
        <button className="ghost danger" onClick={onDelete}>
          删除
        </button>
      </div>

      <table className="field-table">
        <thead>
          <tr>
            <th>状态字段</th>
            <th>初始（默认）值</th>
            <th style={{ width: 70 }}></th>
          </tr>
        </thead>
        <tbody>
          {entity.fields.map((field) => (
            <FieldRow key={field.id} field={field} onChange={onChange} notify={notify} />
          ))}
          {entity.fields.length === 0 && (
            <tr>
              <td colSpan={3} className="muted small">
                尚无状态字段
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <div className="inline-form tight">
        <input
          placeholder="新字段名，如：服装"
          value={newField}
          onChange={(e) => setNewField(e.target.value)}
        />
        <input
          placeholder="初始值，如：白色T恤"
          value={newDefault}
          onChange={(e) => setNewDefault(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addField()}
        />
        <button disabled={!newField.trim()} onClick={addField}>
          添加字段
        </button>
      </div>
    </section>
  );
}

function FieldRow({
  field,
  onChange,
  notify,
}: {
  field: Field;
  onChange: () => Promise<void>;
  notify: (msg: string) => void;
}) {
  const [name, setName] = useState(field.name);
  const [defaultVal, setDefaultVal] = useState(field.defaultVal);
  const dirty = name !== field.name || defaultVal !== field.defaultVal;

  async function save() {
    try {
      await api.updateField(field.id, { name: name.trim(), defaultVal });
      await onChange();
      notify('字段已保存，已自动重算');
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
      setName(field.name);
      setDefaultVal(field.defaultVal);
    }
  }

  async function remove() {
    if (!confirm(`删除字段「${field.name}」及其全部快照/变更？`)) return;
    try {
      await api.deleteField(field.id);
      await onChange();
      notify('字段已删除');
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <tr>
      <td>
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </td>
      <td>
        <input value={defaultVal} onChange={(e) => setDefaultVal(e.target.value)} />
      </td>
      <td className="row-actions">
        {dirty && (
          <button className="ghost primary" onClick={save}>
            保存
          </button>
        )}
        <button className="ghost danger" onClick={remove}>
          ×
        </button>
      </td>
    </tr>
  );
}
