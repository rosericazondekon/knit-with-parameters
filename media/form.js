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
    const isNull = row.nullInput.checked;
    row.nullInput.disabled = busy;
    row.control.disabled = busy || isNull;
    if (row.browseButton) row.browseButton.disabled = busy || isNull || row.requestId !== undefined;
    row.control.setAttribute('aria-disabled', String(row.control.disabled));
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

  function createControl(parameter, controlId) {
    const type = String(parameter.type || 'text').toLowerCase();
    const multiple = type === 'select' && Boolean(parameter.multiple);
    let control;
    let choices = [];

    if (type === 'select') {
      control = document.createElement('select');
      control.multiple = multiple;
      choices = Array.isArray(parameter.choices) ? parameter.choices : [];
      choices.forEach((choice, index) => {
        const option = document.createElement('option');
        option.value = String(index);
        option.textContent = String(choice && choice.label != null ? choice.label : choice && choice.value != null ? choice.value : '');
        option.selected = initialChoiceIndexes(choices, parameter.value, multiple).includes(String(index));
        control.append(option);
      });
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
        addNumberAttributes(control, parameter);
        if (parameter.value !== undefined && parameter.value !== null) {
          control.value = String(parameter.value);
        }
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

      const nullLabel = document.createElement('label');
      nullLabel.className = 'choice-toggle';
      const nullInput = document.createElement('input');
      nullInput.type = 'checkbox';
      nullInput.checked = parameter.value === null;
      nullLabel.append(nullInput, document.createTextNode(' Use NULL'));
      row.append(nullLabel);

      const parameterRow = { parameter, control, choices, type, nullInput };
      if (type === 'file') {
        const browseButton = document.createElement('button');
        browseButton.type = 'button';
        browseButton.textContent = 'Browse…';
        browseButton.setAttribute('aria-label', `Browse for ${labelText}`);
        parameterRow.browseButton = browseButton;
        browseButton.addEventListener('click', () => {
          if (busy || nullInput.checked || parameterRow.requestId !== undefined) return;
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
      nullInput.addEventListener('change', () => {
        clearFileRequest(parameterRow, true);
        applyRowState(parameterRow);
      });
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
        value: row.nullInput.checked ? null : controlValue(row)
      };
      return values;
    }, Object.create(null));
  }

  function validateOverrides() {
    for (const row of parameterRows) {
      if (!row.nullInput.checked && row.type === 'numeric' && row.control.value === '') {
        setStatus(`Enter a number for ${row.parameter.label != null ? row.parameter.label : row.parameter.name}, or use NULL.`);
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
      if (!busy && !row.nullInput.checked && typeof message.value === 'string') {
        row.control.value = message.value;
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
