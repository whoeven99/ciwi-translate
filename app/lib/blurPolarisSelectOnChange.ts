const POLARIS_SELECT_INPUT = "Polaris-Select__Input";

function isPolarisSelectInput(target: EventTarget | null): target is HTMLSelectElement {
  return (
    target instanceof HTMLSelectElement &&
    target.classList.contains(POLARIS_SELECT_INPUT) &&
    !target.disabled
  );
}

function blurPolarisSelect(target: EventTarget | null) {
  if (!isPolarisSelectInput(target)) return;
  target.blur();
}

/** 指针选完后立刻失焦，避免 Polaris Select 蓝框在原生下拉关闭后仍留着。键盘 Tab 不 blur。 */
export function installBlurPolarisSelectOnChange(): () => void {
  let fromPointer = false;

  const onPointerDown = () => {
    fromPointer = true;
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    fromPointer = false;
  };

  const onChange = (event: Event) => {
    if (!fromPointer) return;
    const { target } = event;
    blurPolarisSelect(target);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => blurPolarisSelect(target));
    });
  };

  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("keydown", onKeyDown, true);
  document.addEventListener("change", onChange, true);

  return () => {
    document.removeEventListener("pointerdown", onPointerDown, true);
    document.removeEventListener("keydown", onKeyDown, true);
    document.removeEventListener("change", onChange, true);
  };
}
