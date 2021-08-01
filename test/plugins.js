import test from 'ava';
import sh from 'shelljs';
import sinon from 'sinon';
import Log from '../lib/log.js';
import Spinner from '../lib/spinner.js';
import Config from '../lib/config.js';
import { parseGitUrl } from '../lib/util.js';
import runTasks from '../lib/tasks.js';
import MyPlugin from './stub/plugin.js';
import ReplacePlugin from './stub/plugin-replace.js';
import ContextPlugin from './stub/plugin-context.js';
import { mkTmpDir } from './util/helpers.js';
import ShellStub from './stub/shell.js';

const rootDir = new URL('..', import.meta.url);

const noop = Promise.resolve();

const sandbox = sinon.createSandbox();

const testConfig = {
  ci: true,
  config: false,
  'disable-metrics': true
};

const log = sandbox.createStubInstance(Log);
const spinner = sandbox.createStubInstance(Spinner);
spinner.show.callsFake(({ enabled = true, task }) => (enabled ? task() : noop));

const getContainer = options => {
  const config = new Config(Object.assign({}, testConfig, options));
  const shell = new ShellStub({ container: { log, config } });
  return {
    log,
    spinner,
    config,
    shell
  };
};

test.serial.beforeEach(t => {
  const dir = mkTmpDir();
  sh.pushd('-q', dir);
  t.context = { dir };
});

test.serial.afterEach(() => {
  sandbox.resetHistory();
});

test.serial('should instantiate plugins and execute all release-cycle methods', async t => {
  sh.ShellString(JSON.stringify({ name: 'project', version: '1.0.0', type: 'module' })).toEnd('package.json');
  sh.exec(`npm install ${rootDir}`);

  const pluginDir = mkTmpDir();
  sh.pushd('-q', pluginDir);
  sh.ShellString(JSON.stringify({ name: 'my-plugin', version: '1.0.0', type: 'module' })).toEnd('package.json');
  sh.exec(`npm install ${rootDir}`);
  const content = "import { Plugin } from 'release-it'; " + MyPlugin.toString() + '; export default MyPlugin;';
  sh.ShellString(content).toEnd('index.js');
  sh.popd();

  sh.mkdir('-p', 'my/plugin');
  sh.pushd('-q', 'my/plugin');
  sh.ShellString(content).toEnd('index.js');
  sh.popd();

  sh.exec(`npm install ${pluginDir}`);

  const config = {
    plugins: {
      'my-plugin': {
        name: 'foo'
      },
      './my/plugin/index.js': [
        'named-plugin',
        {
          name: 'bar'
        }
      ]
    }
  };
  const container = getContainer(config);

  const result = await runTasks({}, container);

  t.deepEqual(container.log.info.args, [
    ['my-plugin:foo:init'],
    ['named-plugin:bar:init'],
    ['my-plugin:foo:getName'],
    ['my-plugin:foo:getLatestVersion'],
    ['my-plugin:foo:getIncrement'],
    ['my-plugin:foo:getIncrementedVersionCI'],
    ['named-plugin:bar:getIncrementedVersionCI'],
    ['my-plugin:foo:beforeBump'],
    ['named-plugin:bar:beforeBump'],
    ['my-plugin:foo:bump:1.3.0'],
    ['named-plugin:bar:bump:1.3.0'],
    ['my-plugin:foo:beforeRelease'],
    ['named-plugin:bar:beforeRelease'],
    ['my-plugin:foo:release'],
    ['named-plugin:bar:release'],
    ['my-plugin:foo:afterRelease'],
    ['named-plugin:bar:afterRelease']
  ]);

  t.deepEqual(result, {
    changelog: undefined,
    name: 'new-project-name',
    latestVersion: '1.2.3',
    version: '1.3.0'
  });
});

test.serial('should disable core plugins', async t => {
  sh.ShellString(JSON.stringify({ name: 'project', version: '1.0.0' })).toEnd('package.json');
  sh.exec(`npm install release-it@^14`);
  const content = "const { Plugin } = require('release-it'); module.exports = " + ReplacePlugin.toString();
  sh.ShellString(content).toEnd('replace-plugin.js');

  const config = {
    plugins: {
      './replace-plugin.js': {}
    }
  };
  const container = getContainer(config);

  const result = await runTasks({}, container);

  t.deepEqual(result, {
    changelog: undefined,
    name: undefined,
    latestVersion: undefined,
    version: undefined
  });
});

test.serial('should expose context to execute commands', async t => {
  sh.ShellString(JSON.stringify({ name: 'pkg-name', version: '1.0.0', type: 'module' })).toEnd('package.json');
  sh.exec(`npm install ${rootDir}`);

  const content =
    "import { Plugin } from 'release-it'; " + ContextPlugin.toString() + '; export default ContextPlugin;';
  sh.ShellString(content).toEnd('context-plugin.js');

  const repo = parseGitUrl('https://github.com/user/pkg');

  const container = getContainer({ plugins: { './context-plugin.js': {} } });
  const exec = sinon.spy(container.shell, 'execFormattedCommand');

  container.config.setContext({ repo });
  container.config.setContext({ tagName: '1.0.1' });

  await runTasks({}, container);

  const pluginExecArgs = exec.args
    .map(args => args[0])
    .filter(arg => typeof arg === 'string' && arg.startsWith('echo'));

  t.deepEqual(pluginExecArgs, [
    'echo false',
    'echo false',
    `echo pkg-name user 1.0.0 1.0.1`,
    `echo pkg-name user 1.0.0 1.0.1`,
    `echo user pkg user/pkg 1.0.1`,
    `echo user pkg user/pkg 1.0.1`,
    `echo user pkg user/pkg 1.0.1`,
    `echo user pkg user/pkg 1.0.1`,
    `echo pkg 1.0.0 1.0.1 1.0.1`,
    `echo pkg 1.0.0 1.0.1 1.0.1`,
    `echo pkg 1.0.0 1.0.1 1.0.1`,
    `echo pkg 1.0.0 1.0.1 1.0.1`
  ]);
});