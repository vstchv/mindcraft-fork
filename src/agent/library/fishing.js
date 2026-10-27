// A conservative casting corridor, including space beyond the intended splash.
export function playerInCastPath(bot, target) {
    const origin = bot.entity.position;
    const dx = target.x - origin.x,
        dz = target.z - origin.z;
    const length = Math.hypot(dx, dz);
    if (length < 0.5) return true;
    return Object.values(bot.entities).some((entity) => {
        if (entity === bot.entity || entity.type !== 'player') return false;
        const x = entity.position.x - origin.x,
            z = entity.position.z - origin.z;
        const along = (x * dx + z * dz) / length;
        const sideways = Math.abs(x * dz - z * dx) / length;
        return (
            along > -1 &&
            along < length + 4 &&
            sideways < 2 &&
            Math.abs(entity.position.y - origin.y) < 4
        );
    });
}

export async function castAndWait(bot, target, timeoutMs = 45000) {
    if (bot.interrupt_code) return 'Interrupted before casting.';
    await bot.lookAt(target, true);
    if (playerInCastPath(bot, target))
        return 'Player in casting direction. No cast made; ask them to step aside.';
    const before = new Map();
    for (const item of bot.inventory.items())
        before.set(item.name, (before.get(item.name) || 0) + item.count);
    let done = false,
        error,
        cast = false;
    try {
        cast = true;
        // Attach rejection handling immediately, including when cancellation wins.
        bot.fish().then(
            () => {
                done = true;
            },
            (e) => {
                error = e;
                done = true;
            },
        );
        const deadline = Date.now() + timeoutMs;
        while (!done && Date.now() < deadline && !bot.interrupt_code) {
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
        if (!done)
            return bot.interrupt_code
                ? 'Fishing interrupted.'
                : 'No bite before timeout; no catch confirmed.';
        cast = false;
        if (error) return `Fishing failed: ${error.message}. No catch confirmed.`;
        // Reeling can complete before the item reaches the inventory.
        for (let attempt = 0; attempt < 20 && !bot.interrupt_code; attempt++) {
            const after = new Map();
            for (const item of bot.inventory.items())
                after.set(item.name, (after.get(item.name) || 0) + item.count);
            const gained = [...after].filter(
                ([name, count]) => count > (before.get(name) || 0) && name !== 'fishing_rod',
            );
            if (gained.length)
                return `Reeled in after a bite. Inventory gained: ${gained.map(([name, count]) => `${count - (before.get(name) || 0)} ${name}`).join(', ')}.`;
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
        return 'Reeled in after a bite, but no inventory gain confirmed. Do not claim a successful catch.';
    } finally {
        // Retract an outstanding cast when stopped or timed out.
        if (cast && bot.heldItem?.name === 'fishing_rod') bot.activateItem();
    }
}
