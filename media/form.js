(() => {
  'use strict';

  const vscode = acquireVsCodeApi();
  const form = document.getElementById('form');
  const fields = document.getElementById('fields');
  const title = document.getElementById('title');
  const status = document.getElementById('status');
  const knitButton = document.getElementById('knit');
  const cancelButton = document.getElementById('cancel');
  const refreshButton = document.getElementById('refresh');

  let parameterRows = [];
  let busy = false;
  let fileRequestId = 0;

  function clearFileRequest(row, clearStatus) {
    if (!row || row.type !== 'file' || row.requestId === undefined) return;
    if (row.fileRequestTimer !== undefined) {
      window.clearTimeout(row.fileRequestTimer);
    }
    row.requestId = undefined;
    row.fileRequestTimer = undefined;
    row.awaitingFilePickerAck = false;
    if (row.browseButton) row.browseButton.textContent = 'Browse…';
    if (clearStatus) setStatus('');
    applyRowState(row);
  }

  function clearAllFileRequests(clearStatus) {
    parameterRows.forEach(row => clearFileRequest(row, clearStatus));
  }

  function setStatus(text) {
    status.textContent = typeof text === 'string' ? text : '';
  }

  function hasOwn(object, key) {
    return Object.prototype.hasOwnProperty.call(object, key);
  }

  function sameValue(left, right) {
    if (Object.is(left, right)) {
      return true;
    }
    if (left && right && typeof left === 'object' && typeof right === 'object') {
      try {
        return JSON.stringify(left) === JSON.stringify(right);
      } catch (_) {
        return false;
      }
    }
    return false;
  }

  function makeId(name, suffix) {
    return `parameter-${String(name).replace(/[^A-Za-z0-9_-]/g, '-')}-${suffix}`;
  }

  function applyRowState(row) {
    row.control.disabled = busy;
    if (row.browseButton) row.browseButton.disabled = busy || row.requestId !== undefined;
    row.control.setAttribute('aria-disabled', String(row.control.disabled));
    if (row.selectUi) row.selectUi.updateDisabled();
  }

  function applyState() {
    parameterRows.forEach(applyRowState);
    knitButton.disabled = busy;
    refreshButton.disabled = busy;
    cancelButton.disabled = false;
  }

  function setBusy(nextBusy) {
    busy = Boolean(nextBusy);
    if (busy) clearAllFileRequests(false);
    form.setAttribute('aria-busy', String(busy));
    applyState();
  }

  function initialChoiceIndexes(choices, value, multiple) {
    const values = multiple && Array.isArray(value) ? value : [value];
    return choices.reduce((indexes, choice, index) => {
      if (values.some((item) => sameValue(item, choice.value))) {
        indexes.push(String(index));
      }
      return indexes;
    }, []);
  }

  function addNumberAttributes(control, parameter) {
    ['min', 'max', 'step'].forEach((attribute) => {
      if (hasOwn(parameter, attribute) && parameter[attribute] !== null && parameter[attribute] !== '') {
        control.setAttribute(attribute, String(parameter[attribute]));
      }
    });
  }

  function sliderBounds(parameter) {
    const min = typeof parameter.min === 'number' && Number.isFinite(parameter.min) ? parameter.min : 0;
    const max = typeof parameter.max === 'number' && Number.isFinite(parameter.max) ? parameter.max : 100;
    return { min, max: Math.max(min, max) };
  }

  function sliderStep(parameter, min, max) {
    if (typeof parameter.step === 'number' && Number.isFinite(parameter.step) && parameter.step > 0) {
      return parameter.step;
    }
    const span = max - min;
    // Use finer increments for fractional bounds and small ranges.
    if (span > 0 && (span < 2 || !Number.isInteger(min) || !Number.isInteger(max))) {
      return Math.pow(10, Math.floor(Math.log10(span / 100))) || 1;
    }
    return 1;
  }

  function formatSliderValue(value, parameter) {
    const separator = typeof parameter.sep === 'string' ? parameter.sep : ',';
    const prefix = typeof parameter.pre === 'string' ? parameter.pre : '';
    const suffix = typeof parameter.post === 'string' ? parameter.post : '';
    // Remove floating-point noise without padding labels with trailing zeroes.
    const clean = Number(value.toPrecision(12));
    const parts = String(Object.is(clean, -0) ? 0 : clean).split('.');
    if (!/[eE]/.test(parts.join('.'))) {
      parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, () => separator);
    }
    return `${prefix}${parts.join('.')}${suffix}`;
  }

  function decorateSlider(row, wrapper) {
    const { parameter, control } = row;
    const min = Number(control.min);
    const max = Number(control.max);
    const span = max - min;
    const step = Number(control.step);
    wrapper.classList.add('slider-control');

    const labels = document.createElement('div');
    labels.className = 'slider-labels';
    const minimum = document.createElement('span');
    minimum.className = 'slider-min';
    minimum.textContent = formatSliderValue(min, parameter);
    const maximum = document.createElement('span');
    maximum.className = 'slider-max';
    maximum.textContent = formatSliderValue(max, parameter);
    const output = document.createElement('output');
    output.className = 'slider-value';
    output.setAttribute('for', control.id);
    output.setAttribute('aria-hidden', 'true');
    labels.append(minimum, maximum, output);
    wrapper.prepend(labels);

    if (parameter.ticks !== false && span > 0) {
      const scale = document.createElement('div');
      scale.className = 'slider-scale';
      scale.setAttribute('aria-hidden', 'true');
      // Keep large ranges bounded: sample selectable steps, never thousands of DOM nodes.
      const intervals = Math.floor(span / step + 1e-9);
      const stride = Math.max(1, Math.ceil(intervals / 40));
      const values = [];
      for (let index = 0; index <= 40 && index * stride <= intervals; index++) {
        const value = Math.min(max, min + index * stride * step);
        values.push(Math.abs(value) < step * 1e-10 ? 0 : value);
      }
      if (!values.length || Math.abs(values[values.length - 1] - max) > span * 1e-10) values.push(max);
      const labelStride = Math.max(1, Math.ceil((values.length - 1) / 4));
      values.forEach((value, index) => {
        const tick = document.createElement('span');
        tick.className = 'slider-tick';
        tick.style.left = `${(value - min) / span * 100}%`;
        tick.dataset.value = String(Number(value.toPrecision(12)));
        if (index % labelStride === 0 || index === values.length - 1) {
          tick.classList.add('slider-tick-major');
          // Endpoints already have labels above the track.
          if (index > 0 && index < values.length - 1) {
            const label = document.createElement('span');
            label.className = 'slider-tick-label';
            label.textContent = formatSliderValue(value, parameter);
            tick.append(label);
          }
        }
        scale.append(tick);
      });
      wrapper.append(scale);
    }

    const update = () => {
      const value = control.valueAsNumber;
      const fraction = span > 0 ? Math.max(0, Math.min(1, (value - min) / span)) : 0;
      const text = row.nullDefault ? 'NULL' : formatSliderValue(value, parameter);
      output.textContent = text;
      // Track and label positions account for the native thumb's 16px width.
      output.style.left = `calc(${fraction * 100}% + ${8 - fraction * 16}px)`;
      output.style.transform = `translateX(-${fraction * 100}%)`;
      control.style.setProperty('--slider-progress', `${fraction * 100}%`);
      control.setAttribute('aria-valuetext', text);
    };
    control.addEventListener('input', update);
    control.addEventListener('change', update);
    update();
  }

  function choiceLabel(choice) {
    return String(choice && choice.label != null ? choice.label : choice && choice.value != null ? choice.value : '');
  }

  function emitSelectEdit(control) {
    control.dispatchEvent(new Event('input', { bubbles: true }));
    control.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function decorateSelect(row, wrapper, labelText) {
    const { control, choices, parameter } = row;
    if (parameter.selectize === false) return;

    const multiple = control.multiple;
    const widget = document.createElement('div');
    widget.className = `selectize-control${multiple ? ' selectize-multiple' : ' selectize-single'}`;

    const inputArea = document.createElement('div');
    inputArea.className = 'selectize-input';
    const chips = document.createElement('div');
    chips.className = 'selectize-chips';
    const search = document.createElement('input');
    search.type = 'text';
    search.className = 'selectize-search';
    search.setAttribute('role', 'combobox');
    search.setAttribute('aria-autocomplete', 'list');
    search.setAttribute('aria-expanded', 'false');
    search.setAttribute('aria-label', String(labelText));
    if (control.hasAttribute('aria-describedby')) {
      search.setAttribute('aria-describedby', control.getAttribute('aria-describedby'));
    }
    search.autocomplete = 'off';
    search.placeholder = parameter.placeholder != null ? String(parameter.placeholder) : (multiple ? 'Select…' : 'Select an option…');

    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'selectize-clear';
    clear.textContent = '×';
    clear.setAttribute('aria-label', `Clear ${labelText}`);

    const list = document.createElement('div');
    list.className = 'selectize-dropdown';
    list.id = `${control.id}-listbox`;
    list.setAttribute('role', 'listbox');
    if (multiple) list.setAttribute('aria-multiselectable', 'true');
    list.hidden = true;
    search.setAttribute('aria-controls', list.id);

    inputArea.append(chips, search, clear);
    widget.append(inputArea, list);
    wrapper.append(widget);
    control.classList.add('selectize-native');
    control.tabIndex = -1;
    control.setAttribute('aria-hidden', 'true');

    let open = false;
    let activeIndex = -1;
    let visibleIndexes = [];
    let rendering = false;
    let internalChange = false;

    const emitEdit = () => {
      internalChange = true;
      emitSelectEdit(control);
      internalChange = false;
    };

    const selectedIndexes = () => Array.from(control.options)
      .map((option, index) => option.selected ? index : -1)
      .filter(index => index >= 0);

    const close = () => {
      open = false;
      activeIndex = -1;
      list.hidden = true;
      search.setAttribute('aria-expanded', 'false');
      search.removeAttribute('aria-activedescendant');
    };

    const setActive = (next) => {
      if (!visibleIndexes.length) {
        activeIndex = -1;
        search.removeAttribute('aria-activedescendant');
        return;
      }
      activeIndex = Math.max(0, Math.min(next, visibleIndexes.length - 1));
      Array.from(list.querySelectorAll('[role="option"]')).forEach((option, index) => {
        option.classList.toggle('active', index === activeIndex);
      });
      const active = list.querySelectorAll('[role="option"]')[activeIndex];
      if (active) {
        search.setAttribute('aria-activedescendant', active.id);
        active.scrollIntoView?.({ block: 'nearest' });
      }
    };

    const choose = (choiceIndex) => {
      if (search.disabled || choiceIndex < 0 || choiceIndex >= control.options.length) return;
      if (!multiple) {
        Array.from(control.options).forEach((option, index) => { option.selected = index === choiceIndex; });
      } else {
        control.options[choiceIndex].selected = true;
      }
      search.value = '';
      emitEdit();
      if (!multiple) close();
      render();
      search.focus();
    };

    const remove = (choiceIndex) => {
      if (search.disabled || !control.options[choiceIndex]) return;
      control.options[choiceIndex].selected = false;
      emitEdit();
      render();
      search.focus();
    };

    const render = () => {
      if (rendering) return;
      rendering = true;
      const selected = selectedIndexes();
      chips.replaceChildren();
      if (multiple) {
        selected.forEach((choiceIndex) => {
          const chip = document.createElement('span');
          chip.className = 'selectize-chip';
          const chipLabel = document.createElement('span');
          chipLabel.textContent = choiceLabel(choices[choiceIndex]);
          const removeButton = document.createElement('button');
          removeButton.type = 'button';
          removeButton.className = 'selectize-remove';
          removeButton.textContent = '×';
          removeButton.setAttribute('aria-label', `Remove ${choiceLabel(choices[choiceIndex])}`);
          removeButton.disabled = search.disabled;
          removeButton.addEventListener('click', () => remove(choiceIndex));
          chip.append(chipLabel, removeButton);
          chips.append(chip);
        });
      } else if (!open) {
        search.value = selected.length ? choiceLabel(choices[selected[0]]) : '';
      }
      clear.hidden = selected.length === 0;
      clear.disabled = search.disabled;

      const query = search.value.toLocaleLowerCase();
      visibleIndexes = choices.reduce((indexes, choice, index) => {
        if ((!multiple || !control.options[index].selected) && choiceLabel(choice).toLocaleLowerCase().includes(query)) indexes.push(index);
        return indexes;
      }, []);
      list.replaceChildren();
      if (!visibleIndexes.length) {
        const empty = document.createElement('div');
        empty.className = 'selectize-empty';
        empty.textContent = choices.length ? 'No matches' : 'No options';
        list.append(empty);
        activeIndex = -1;
        search.removeAttribute('aria-activedescendant');
      } else {
        visibleIndexes.forEach((choiceIndex, position) => {
          const option = document.createElement('div');
          option.id = `${control.id}-option-${choiceIndex}`;
          option.className = 'selectize-option';
          option.setAttribute('role', 'option');
          option.setAttribute('aria-selected', String(control.options[choiceIndex].selected));
          option.textContent = choiceLabel(choices[choiceIndex]);
          option.addEventListener('mousedown', event => event.preventDefault());
          option.addEventListener('click', () => choose(choiceIndex));
          list.append(option);
          if (position === activeIndex) option.classList.add('active');
        });
        if (activeIndex >= visibleIndexes.length) activeIndex = visibleIndexes.length - 1;
      }
      if (open && activeIndex >= 0) setActive(activeIndex);
      rendering = false;
    };

    const show = (clearSingleLabel) => {
      if (search.disabled) return;
      open = true;
      if (clearSingleLabel && !multiple) search.value = '';
      search.setAttribute('aria-expanded', 'true');
      list.hidden = false;
      activeIndex = -1;
      search.removeAttribute('aria-activedescendant');
      render();
    };

    search.addEventListener('focus', () => show(true));
    search.addEventListener('click', () => { if (!open) show(true); });
    search.addEventListener('input', () => { show(false); });
    search.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        if (!open) show(true);
        setActive(event.key === 'ArrowDown' ? activeIndex + 1 : (activeIndex < 0 ? visibleIndexes.length - 1 : activeIndex - 1));
      } else if (event.key === 'Enter') {
        event.preventDefault();
        if (open && visibleIndexes.length) choose(visibleIndexes[activeIndex < 0 ? 0 : activeIndex]);
        else if (!open) show(true);
      } else if (event.key === 'Backspace' && multiple && search.value === '') {
        const selected = selectedIndexes();
        if (selected.length) {
          event.preventDefault();
          remove(selected[selected.length - 1]);
        }
      } else if (event.key === 'Escape' && open) {
        event.preventDefault();
        close();
        render();
      }
    });
    inputArea.addEventListener('mousedown', (event) => {
      if (event.target !== clear && !event.target.closest('.selectize-remove')) search.focus();
    });
    clear.addEventListener('click', () => {
      if (search.disabled) return;
      if (multiple) Array.from(control.options).forEach(option => { option.selected = false; });
      else control.selectedIndex = -1;
      search.value = '';
      emitEdit();
      render();
      search.focus();
    });
    control.addEventListener('change', () => {
      if (!internalChange) {
        close();
        render();
      }
    });
    const outsideClick = (event) => {
      if (!widget.contains(event.target)) {
        close();
        render();
      }
    };
    const focusOutside = (event) => {
      if (!widget.contains(event.target)) {
        close();
        render();
      }
    };
    document.addEventListener('mousedown', outsideClick);
    document.addEventListener('focusin', focusOutside);

    row.selectUi = {
      widget,
      search,
      updateDisabled() {
        search.disabled = busy;
        clear.disabled = busy;
        widget.classList.toggle('disabled', busy);
        if (busy) close();
        render();
      }
    };
    row.cleanup = () => {
      document.removeEventListener('mousedown', outsideClick);
      document.removeEventListener('focusin', focusOutside);
    };
    render();
  }

  function createControl(parameter, controlId) {
    const type = String(parameter.type || 'text').toLowerCase();
    const multiple = type === 'select' && Boolean(parameter.multiple);
    let control;
    let choices = [];

    if (type === 'select') {
      control = document.createElement('select');
      control.multiple = multiple;
      choices = Array.isArray(parameter.choices) ? parameter.choices : [];
      const selectedIndexes = initialChoiceIndexes(choices, parameter.value, multiple);
      choices.forEach((choice, index) => {
        const option = document.createElement('option');
        option.value = String(index);
        option.textContent = choiceLabel(choice);
        option.selected = selectedIndexes.includes(String(index));
        control.append(option);
      });
      // Browsers otherwise select the first option in a single select, which must
      // not visually or semantically replace an explicit NULL default.
      if (!multiple && parameter.value === null) control.selectedIndex = -1;
    } else {
      control = document.createElement('input');
      if (type === 'numeric') {
        control.type = 'number';
        control.step = 'any';
        addNumberAttributes(control, parameter);
        if (parameter.value !== undefined && parameter.value !== null) {
          control.value = String(parameter.value);
        }
      } else if (type === 'slider') {
        control.type = 'range';
        const { min, max } = sliderBounds(parameter);
        control.min = String(min);
        control.max = String(max);
        control.step = String(sliderStep(parameter, min, max));
        control.value = parameter.value !== undefined && parameter.value !== null ? String(parameter.value) : String(min);
      } else if (type === 'date') {
        control.type = 'date';
        if (parameter.value !== undefined && parameter.value !== null) {
          control.value = String(parameter.value);
        }
      } else if (type === 'checkbox') {
        control.type = 'checkbox';
        control.checked = Boolean(parameter.value);
      } else {
        control.type = type === 'password' ? 'password' : 'text';
        if (parameter.value !== undefined && parameter.value !== null) {
          control.value = String(parameter.value);
        }
      }
    }

    control.id = controlId;
    control.name = String(parameter.name);
    if (parameter.placeholder != null && control instanceof HTMLInputElement && control.type !== 'checkbox') {
      control.placeholder = String(parameter.placeholder);
    }
    return { control, choices, type };
  }

  function renderSchema(message) {
    const parameters = Array.isArray(message.parameters) ? message.parameters : [];
    clearAllFileRequests(true);
    parameterRows.forEach(row => { if (row.cleanup) row.cleanup(); });
    fields.replaceChildren();
    parameterRows = [];
    title.textContent = message.file ? `Knit ${message.file}` : 'Knit with parameters';

    parameters.forEach((parameter, index) => {
      if (!parameter || parameter.name == null) {
        return;
      }
      const row = document.createElement('fieldset');
      row.className = 'parameter-row';
      const legend = document.createElement('legend');
      const controlId = makeId(parameter.name, index);
      const labelText = parameter.label != null ? parameter.label : parameter.name;
      legend.textContent = String(labelText);
      row.append(legend);

      const { control, choices, type } = createControl(parameter, controlId);
      control.setAttribute('aria-label', String(labelText));
      const descriptionId = makeId(parameter.name, `description-${index}`);
      if (parameter.description != null && parameter.description !== '') {
        const description = document.createElement('p');
        description.id = descriptionId;
        description.className = 'description';
        description.textContent = String(parameter.description);
        row.append(description);
        control.setAttribute('aria-describedby', descriptionId);
      }

      const controlWrap = document.createElement('div');
      controlWrap.className = 'control-wrap';
      controlWrap.append(control);
      row.append(controlWrap);

      const parameterRow = { parameter, control, choices, type, nullDefault: parameter.value === null };
      const markEdited = () => { parameterRow.nullDefault = false; };
      control.addEventListener('input', markEdited);
      control.addEventListener('change', markEdited);
      if (type === 'slider') decorateSlider(parameterRow, controlWrap);
      if (type === 'select') decorateSelect(parameterRow, controlWrap, labelText);
      if (type === 'file') {
        const browseButton = document.createElement('button');
        browseButton.type = 'button';
        browseButton.textContent = 'Browse…';
        browseButton.setAttribute('aria-label', `Browse for ${labelText}`);
        parameterRow.browseButton = browseButton;
        browseButton.addEventListener('click', () => {
          if (busy || parameterRow.requestId !== undefined) return;
          parameterRow.requestId = ++fileRequestId;
          parameterRow.awaitingFilePickerAck = true;
          browseButton.textContent = 'Opening…';
          setStatus('Opening file picker…');
          applyRowState(parameterRow);
          const requestId = parameterRow.requestId;
          parameterRow.fileRequestTimer = window.setTimeout(() => {
            if (parameterRow.requestId !== requestId || !parameterRow.awaitingFilePickerAck) return;
            clearFileRequest(parameterRow, false);
            setStatus('File picker did not respond. Reload the editor window and reopen Parameters, then try again.');
          }, 8000);
          vscode.postMessage({ type: 'pickFile', name: parameter.name, requestId });
        });
        control.addEventListener('input', () => clearFileRequest(parameterRow, true));
        controlWrap.append(browseButton);
      }
      parameterRows.push(parameterRow);
      fields.append(row);
    });
    applyState();
  }

  function controlValue(row) {
    if (row.type === 'select') {
      const indexes = Array.from(row.control.selectedOptions, (option) => Number(option.value));
      const values = indexes.map((index) => row.choices[index] && row.choices[index].value);
      return row.control.multiple ? values : (values[0] === undefined ? null : values[0]);
    }
    if (row.type === 'checkbox') {
      return row.control.checked;
    }
    if (row.type === 'numeric' || row.type === 'slider') {
      return row.control.valueAsNumber;
    }
    return row.control.value;
  }

  function collectValues() {
    return parameterRows.reduce((values, row) => {
      values[row.parameter.name] = {
        value: row.nullDefault ? null : controlValue(row)
      };
      return values;
    }, Object.create(null));
  }

  function validateOverrides() {
    for (const row of parameterRows) {
      if (!row.nullDefault && row.type === 'numeric' && row.control.value === '') {
        setStatus(`Enter a number for ${row.parameter.label != null ? row.parameter.label : row.parameter.name}.`);
        row.control.focus();
        return false;
      }
    }
    return true;
  }

  form.addEventListener('invalid', (event) => {
    setStatus(`Please correct ${event.target.name || 'the highlighted field'} before knitting.`);
  }, true);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (busy) {
      return;
    }
    if (!form.reportValidity() || !validateOverrides()) {
      return;
    }
    setStatus('');
    vscode.postMessage({ type: 'knit', values: collectValues() });
  });

  cancelButton.addEventListener('click', () => vscode.postMessage({ type: 'cancel' }));
  refreshButton.addEventListener('click', () => {
    if (!busy) {
      clearAllFileRequests(true);
      vscode.postMessage({ type: 'refresh' });
    }
  });

  window.addEventListener('message', (event) => {
    const message = event.data || {};
    if (message.type === 'filePickerOpened') {
      const row = parameterRows.find(item => item.type === 'file' && item.parameter.name === message.name);
      if (!row || !Number.isSafeInteger(message.requestId) || row.requestId !== message.requestId || !row.awaitingFilePickerAck) return;
      if (row.fileRequestTimer !== undefined) window.clearTimeout(row.fileRequestTimer);
      row.fileRequestTimer = undefined;
      row.awaitingFilePickerAck = false;
      row.browseButton.textContent = 'Selecting…';
      return;
    }
    if (message.type === 'filePicked') {
      const row = parameterRows.find(item => item.type === 'file' && item.parameter.name === message.name);
      if (!row || !Number.isSafeInteger(message.requestId) || row.requestId !== message.requestId) return;
      clearFileRequest(row, true);
      if (!busy && typeof message.value === 'string') {
        row.control.value = message.value;
        row.nullDefault = false;
      }
      if (typeof message.error === 'string' && message.error) setStatus(message.error);
      return;
    }
    if (message.type === 'schema') {
      renderSchema(message);
      return;
    }
    if (message.type === 'status') {
      setStatus(message.text);
      setBusy(message.busy);
      return;
    }
    if (message.type === 'error') {
      setStatus(message.text);
      setBusy(false);
    }
  });

  setBusy(false);
  vscode.postMessage({ type: 'ready' });
})();
