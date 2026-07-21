// Guide Path Picker — browser-safe TypeScript module
const PICKER_DATA = {
  start: {
    label: 'Beginner Guide',
    href: '/beginner-guide/',
    desc: 'Understand confirmed systems and prepare for your first run.',
    status: 'Official scope confirmed — some tips require launch verification',
  },
  characters: {
    label: 'Characters',
    href: '/characters/',
    desc: 'Check the confirmed roster names and unlock evidence status.',
    status: 'Official names confirmed — unlock steps not yet verified',
  },
  builds: {
    label: 'Build System',
    href: '/build-system/',
    desc: 'Map the nine confirmed build layers without best-build advice.',
    status: 'System categories confirmed — no best/meta recommendations',
  },
  weapons: {
    label: 'Weapons',
    href: '/weapons/',
    desc: 'Understand the weapon system scope and launch verification status.',
    status: 'System confirmed — full database requires launch check',
  },
  bosses: {
    label: 'Bosses & Stages',
    href: '/bosses-stages/',
    desc: 'Check official launch scope and what still needs verification.',
    status: 'Announced scope confirmed — walkthrough not available',
  },
  coop: {
    label: 'Co-op Guide',
    href: '/co-op/',
    desc: 'Confirm solo and online co-op availability at launch.',
    status: 'Modes confirmed — lobby workflow requires launch check',
  },
  release: {
    label: 'Updates & Release',
    href: '/updates/',
    desc: 'See both official dates, the conflict, and the demo status boundary.',
    status: 'Two conflicting dates shown — no single date is asserted',
  },
} as const;

type PickerKey = keyof typeof PICKER_DATA;

export function initPicker() {
  const buttons = document.querySelectorAll<HTMLButtonElement>('.picker-btn');
  const result = document.getElementById('picker-result');

  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      buttons.forEach((b) => b.classList.remove('selected'));
      btn.classList.add('selected');
      const key = btn.dataset.task as PickerKey | undefined;
      const item = key ? PICKER_DATA[key] : undefined;
      if (result && item) {
        result.innerHTML = `
          <div class="picker-result-label">${item.status}</div>
          <a class="picker-result-link" href="${item.href}">${item.label}</a>
          <p class="picker-result-desc">${item.desc}</p>
        `;
      }
    });
  });
}

// Auto-init when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initPicker);
} else {
  initPicker();
}
