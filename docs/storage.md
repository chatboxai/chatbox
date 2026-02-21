# 存储架构文档

Chatbox 跨平台存储方案和版本迁移机制说明。

## 跨平台存储方案

### 存储类型

- **DESKTOP_FILE**: 桌面端文件存储（通过 IPC）
- **INDEXEDDB**: IndexedDB（通过 localforage）
- **LOCAL_STORAGE**: localStorage（已弃用）
- **MOBILE_SQLITE**: SQLite 数据库（通过 Capacitor）

### 当前方案（v1.17.0）

| 平台 | Settings/Configs | Sessions | 原因 |
|------|-----------------|----------|------|
| **Desktop** | 文件存储 | IndexedDB | 配置便于备份，会话需要大容量 |
| **Mobile** | SQLite | SQLite | 统一存储，性能更好 |
| **Web** | IndexedDB | IndexedDB | 大容量，异步访问 |

## 版本历史

| 版本 | Config Version | Desktop | Mobile | 主要变化 |
|------|---------------|---------|--------|---------|
| v1.9.8-v1.9.10 | 0-5 | 全部 File | localStorage | 初始版本 |
| v1.9.11 | 6-7 | - | **→ SQLite** | Mobile 解决容量限制 |
| v1.12.0 | 7-8 | - | - | 数据格式：sessions → session-list |
| v1.13.1 | 9-10 | - | - | Provider/Session 设置重构 |
| v1.16.1 | 11-12 | **Sessions → IndexedDB**<br/>Configs 保持 File | **→ IndexedDB** | Desktop 分离存储<br/>Mobile 统一到 IndexedDB |
| **v1.17.0** | **12-13** | Sessions 保持 IndexedDB<br/>Configs 保持 File | **→ SQLite** | Desktop 无变化<br/>Mobile 性能优化 |

**关键历史事实**：
- Desktop 的 `configVersion`/`settings`/`configs` **从未** 存储在 IndexedDB 中
- Desktop 从 v1.16.1 开始只将 **sessions** 移到 IndexedDB
- v1.16.1 → v1.17.0，Desktop 存储策略 **完全未变**
- Mobile 的完整演进：localStorage → SQLite (v1.9.11) → IndexedDB (v1.16.1) → SQLite (v1.17.0)

## 迁移机制

### 核心逻辑

```typescript
// 1. 找到最新的旧存储
const [oldConfigVersion, oldStorage] = await findNewestStorage(getOldVersionStorages())

// 2. 判断是否需要迁移数据
if (
  (oldConfigVersion > configVersion || platform.type === 'desktop') &&
  oldStorage &&
  oldStorage.getStorageType() !== storage.getStorageType()  // 存储类型不同
) {
  await doMigrateStorage(oldStorage)  // 迁移数据
}

// 3. 增量升级数据格式
for (; configVersion < CurrentVersion; configVersion++) {
  await migrateFunctions[configVersion]?.(dataStore)
  await setConfigVersion(configVersion + 1)
}
```

### 迁移策略差异

| 平台 | 策略 | 说明 |
|------|------|------|
| **Mobile** | 复制所有 key | 所有数据在同一存储 |
| **Desktop** | 只复制会话数据 | Settings/Configs 保留在文件中 |

## 关键设计决策

### 1. 同类型存储共享数据源

**原则**: 旧存储和当前存储类型相同时，无需迁移数据。

**示例**: Mobile v1.9.11 (SQLite v7) → v1.17.0 (SQLite v13)
- 都用 SQLite，数据已经在那里
- 只需升级数据格式，无需复制数据

### 2. 多个旧存储选最新

**原则**: 存在多个旧存储时，选择 configVersion 最大的。

**示例**: localStorage v5 + IndexedDB v12 → 选择 IndexedDB v12
- 避免迁移过时数据
- 确保用户获得最新状态

### 3. 桌面端混合存储

**原则**: 配置文件便于备份，会话数据用 IndexedDB。

**历史演进**:
- v1.9.x: 所有数据在 config.json 文件中
- v1.16.1: 会话数据移到 IndexedDB，配置保持在文件中
- v1.17.0: 与 v1.16.1 完全相同（无变化）

**关键事实**: 
- `configVersion`/`settings`/`configs` 从未在 IndexedDB 中存储过
- 只有会话数据（`chat-sessions-list`、`session:*`）在 IndexedDB

**特殊处理**: 
- 迁移时只复制会话数据到 IndexedDB
- Settings/Configs 保留在文件存储

### 4. 增量数据格式升级

**原则**: 数据格式升级按版本逐步执行。

**优势**:
- 从任意版本升级都能正确迁移
- 中断后可继续
- 便于维护

## 测试要点

### 覆盖场景

1. ✅ 首次运行（无旧数据）
2. ✅ 版本已是最新（跳过迁移）
3. ✅ 同类型存储（数据已可访问）
4. ✅ 跨存储迁移（File → IndexedDB, localStorage → SQLite）
5. ✅ 多个旧存储共存（选择最新版本）
6. ✅ 历史版本直接升级（跳过中间版本）

### 关键洞察

**1. 同类型存储共享数据源**
```typescript
// 测试 mock 体现
if (type === 'MOBILE_SQLITE') {
  sqliteData = { ...data }  // 共享同一数据容器
}
```

**2. 最新版本优先**
```typescript
// localStorage v5 + IndexedDB v12 → 选择 v12
```

**3. 桌面端部分迁移**
```typescript
// 只迁移 sessions，不迁移 settings/configs
```

**4. 使用真实 Platform 实例**
```typescript
beforeAll(async () => {
  const { default: DesktopPlatformClass } = await import('@/platform/desktop_platform')
  desktopPlatform = new DesktopPlatformClass(window.desktopAPI)
})
```

## 常见问题

**Q: 为什么回退到 SQLite？**  
A: IndexedDB 在某些 WebView 环境存在数据被清理问题，SQLite 更稳定。

**Q: 迁移失败会怎样？**  
A: 捕获异常并记录，应用仍可运行（初始化默认数据）。

**Q: 如何添加新版本？**  
A: 增加 `CurrentVersion`，在 `migrateFunctions` 添加迁移函数，更新文档。

## 参考

- [Migration 源码](../src/renderer/stores/migration.ts)
- [Migration 测试](../src/renderer/stores/migration.test.ts)
- [测试文档](./testing.md)

---

**最后更新**: 2025-10-25 | **当前版本**: v1.17.0 (Config Version 13)
