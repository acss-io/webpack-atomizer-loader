'use strict';

import * as Atomizer from 'atomizer';
import * as cssnano from 'cssnano';
import { getOptions } from 'loader-utils';
import * as postcss from 'postcss';

import { writeCssFile, ensureExists } from './utils';

const DEFAULT_CSS_DEST: string = './build/css/atomic.css';
const DEFAULT_POSTCSS_PLUGIN_LIST: string[] = [];

// cached response to prevent unnecessary update
let cachedResponse: string = '';

const atomizer: any = new Atomizer({ verbose: true });

interface ConfigObject {
    default: object;
}

// Hash to keep track of config loaded by path
let configObject: ConfigObject = {
    default: {
        configs: {
            classNames: []
        }
    }
};

interface PathConfigOption {
    rules: string;
}

interface PathConfig {
    configs: object;
    cssDest: string;
    options: PathConfigOption;
}

const parseAndGenerateFile = function(
    config: PathConfig,
    source: string,
    validPostcssPlugins = [],
    minimize: boolean = false
): Promise<Function> {
    return new Promise((resolve, reject) => {

        const foundClasses = atomizer.findClassNames(source);
        let cssDest = config.cssDest || DEFAULT_CSS_DEST;

        if (!ensureExists(cssDest)) {
            console.warn('[atomic loader] create css failed.');
            return;
        }

        // custom rules file
        if (config.options && config.options.rules) {
            const customRules = require(require.resolve(config.options.rules));
            if (customRules) {
                atomizer.addRules(customRules);
            }
        }

        const finalConfig = atomizer.getConfig(foundClasses, config.configs || {});
        const cssString: string = atomizer.getCss(finalConfig, config.options || {});

        const pipeline = postcss(validPostcssPlugins);
        if (minimize) {
            pipeline.use(cssnano());
        }

        pipeline.process(cssString, { from: undefined }).then(result => {
            const { css = '' } = result;

            if (css === cachedResponse) {
                return resolve();
            }

            writeCssFile(cssDest, css)
                .then(() => {
                    cachedResponse = css;
                    return resolve();
                })
                .catch(err => reject(err));
        });
    });
};

const atomicLoader = function(source, map) {
    const callback = this.async();
    if (this.cacheable) {
        this.cacheable();
    }

    const query = getOptions(this) || {};
    const { config, configPath = [], minimize = false, postcssPlugins = [] } = query;
    let validPostcssPlugins = DEFAULT_POSTCSS_PLUGIN_LIST;

    if (Array.isArray(postcssPlugins)) {
        validPostcssPlugins = postcssPlugins;
    }
    let configs = [
        ...[]
            .concat(configPath)
            .map(configPath => require(require.resolve(configPath))),
        ...config !== undefined ? [query.config] : [],
    ]

    if (configs.length === 0) {
        configs.push(configObject.default)
    }

    const tasks: Promise<Function>[] = configs.map(config => {
        return parseAndGenerateFile(config, source, validPostcssPlugins, minimize);
    });

    Promise.all(tasks)
        .then(() => {
            return callback(null, source);
        })
        .catch(err => {
            return callback(err, source);
        });
};

// export default atomicLoader
module.exports = atomicLoader;
