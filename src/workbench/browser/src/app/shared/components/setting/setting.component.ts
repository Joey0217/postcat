import { Component, OnInit, Input, Output, EventEmitter } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { SelectionModel } from '@angular/cdk/collections';
import { FlatTreeControl } from '@angular/cdk/tree';
import { NzTreeFlatDataSource, NzTreeFlattener } from 'ng-zorro-antd/tree-view';
import { debounce, cloneDeep } from 'lodash';
import { eoapiSettings } from './eoapi-settings/';
import { Message, MessageService } from '../../../shared/services/message';
import { Subject, takeUntil } from 'rxjs';
import { NzMessageService } from 'ng-zorro-antd/message';
import { RemoteService } from 'eo/workbench/browser/src/app/shared/services/remote/remote.service';

interface TreeNode {
  name: string;
  moduleID?: string;
  disabled?: boolean;
  children?: TreeNode[];
  configuration?: any[];
}

interface FlatNode {
  expandable: boolean;
  name: string;
  level: number;
  disabled: boolean;
}

@Component({
  selector: 'eo-setting',
  templateUrl: './setting.component.html',
  styleUrls: ['./setting.component.scss'],
})
export class SettingComponent implements OnInit {
  @Input() set isShowModal(val) {
    this.$isShowModal = val;
    if (val) {
      this.init();
      this.remoteServerUrl = this.settings['eoapi-common.remoteServer.url'];
      this.remoteServerToken = this.settings['eoapi-common.remoteServer.token'];
    }
  }
  get isShowModal() {
    return this.$isShowModal;
  }
  @Output() isShowModalChange = new EventEmitter<any>();
  objectKeys = Object.keys;
  /** 是否远程数据源 */
  get isRemote() {
    return this.remoteService.isRemote;
  }
  /** 当前数据源对应的文本 */
  get dataSourceText() {
    return this.remoteService.dataSourceText;
  }
  private transformer = (node: TreeNode, level: number): FlatNode & TreeNode => ({
    ...node,
    expandable: !!node.children && node.children.length > 0,
    name: node.name,
    level,
    disabled: !!node.disabled,
  });
  selectListSelection = new SelectionModel<FlatNode & TreeNode>();
  treeControl: any = new FlatTreeControl<FlatNode & TreeNode>(
    (node) => node.level,
    (node) => node.expandable
  );

  treeFlattener = new NzTreeFlattener(
    this.transformer,
    (node) => node.level,
    (node) => node.expandable,
    (node) => node.children
  );

  dataSource = new NzTreeFlatDataSource(this.treeControl, this.treeFlattener);
  switchDataSourceLoading = false;
  /** current configuration */
  currentConfiguration = [];
  // ! isVisible = false;
  $isShowModal = false;
  /** current active configure */
  /** all configure */
  settings = {
    'eoapi-common': {},
    'eoapi-theme': {},
    'eoapi-features': {},
    'eoapi-about': {},
  };
  treeNodes = [
    {
      name: 'Data Storage',
      moduleID: 'eoapi-common',
    },
    {
      name: 'Language',
      moduleID: 'eoapi-language',
    },
    {
      name: 'Extensions',
      moduleID: 'eoapi-extensions',
    },
    {
      name: 'About',
      moduleID: 'eoapi-about',
    },
  ];
  /** local configure */
  localSettings = { settings: {}, nestedSettings: {} };
  /** nested settings */
  nestedSettings = {};
  validateForm!: FormGroup;
  /** remote server url */
  remoteServerUrl = '';
  /** remote server token */
  remoteServerToken = '';

  get selected() {
    return this.selectListSelection.selected.at(0)?.moduleID;
  }

  private destroy$: Subject<void> = new Subject<void>();
  constructor(
    private fb: FormBuilder,
    private messageService: MessageService,
    private message: NzMessageService,
    private remoteService: RemoteService
  ) {}

  ngOnInit(): void {
    this.init();
    // this.parseSettings();
    this.messageService
      .get()
      .pipe(takeUntil(this.destroy$))
      .subscribe((inArg: Message) => {
        switch (inArg.type) {
          case 'toggleSettingModalVisible': {
            inArg.data.isShow ? this.handleShowModal() : this.handleCancel();
            break;
          }
          case 'onDataSourceChange': {
            if (inArg.data.showWithSetting) {
              this.remoteService.refreshComponent();
            }
            break;
          }
        }
      });
  }

  hasChild = (_: number, node: FlatNode): boolean => node.expandable;

  /**
   * 切换数据源
   */
  switchDataSource() {
    this.switchDataSourceLoading = true;
    this.remoteService.switchDataSource().finally(() => {
      this.switchDataSourceLoading = false;
    });
    // this.messageService.send({ type: 'switchDataSource', data: { showWithSetting: true } });
  }

  /**
   * 测试远程服务器地址是否可用
   */
  async pingRmoteServerUrl() {
    const { url: remoteUrl, token } = this.getConfiguration('eoapi-common.remoteServer');
    // 是否更新了远程服务地址或token
    const isUpdateRemoteServerInfo = remoteUrl !== this.remoteServerUrl || token !== this.remoteServerToken;
    let messageId;
    if (isUpdateRemoteServerInfo) {
      messageId = this.message.loading('远程服务器连接中...', { nzDuration: 0 }).messageId;
    }

    try {
      const url = `${remoteUrl}/system/status`.replace(/(?<!:)\/{2,}/g, '/');
      const response = await fetch(url, {
        headers: {
          'x-api-key': token,
        },
      });
      const result = await response.json();
      console.log('result', result);
      if (result.statusCode !== 200) {
        throw result;
      }
      // await result.json();
      if (isUpdateRemoteServerInfo) {
        this.message.create('success', '远程服务器地址设置成功');
        return Promise.resolve(true);
      }
    } catch (error) {
      console.error(error);
      // if (remoteUrl !== this.remoteServerUrl) {
      this.message.create('error', '远程服务器地址/token不可用');
      // }
      // 远程服务地址不可用时，回退到上次的地址
      this.settings['eoapi-common.remoteServer.url'] = this.remoteServerUrl;
      this.settings['eoapi-common.remoteServer.token'] = this.remoteServerToken;
    } finally {
      setTimeout(() => this.message.remove(messageId), 500);
    }
  }

  /**
   * 设置数据
   *
   * @param properties
   */
  private setSettingsModel(properties, controls) {
    //  平级配置对象
    Object.keys(properties).forEach((fieldKey) => {
      const props = properties[fieldKey];
      this.settings[fieldKey] = this.localSettings?.settings?.[fieldKey] ?? props.default;
      // 可扩展加入更多默认校验
      if (props.required) {
        controls[fieldKey] = [null, [Validators.required]];
      } else {
        controls[fieldKey] = [null];
      }
    });
    // 深层嵌套的配置对象
    // Object.keys(properties).forEach((fieldKey) => {
    //   const keyArr = fieldKey.split('.');
    //   const keyArrL = keyArr.length - 1;
    //   keyArr.reduce((p, k, i) => {
    //     const isLast = i === keyArrL;
    //     p[k] ??= isLast ? this.settings[fieldKey] : {};
    //     return p[k];
    //   }, this.nestedSettings);
    //   // 当settings变化时，将值同步到nestedSettings
    //   Object.defineProperty(this.settings, fieldKey, {
    //     get: () => this.getConfiguration(fieldKey),
    //     set: (newVal) => {
    //       const target = keyArr.slice(0, -1).reduce((p, k) => p[k], this.nestedSettings);
    //       target[keyArr[keyArrL]] = newVal;
    //     },
    //   });
    // });
  }

  /**
   * 根据key路径获取对应的配置的值
   *
   * @param key
   * @returns
   */
  getConfiguration(key: string) {
    return key.split('.').reduce((p, k) => p[k], this.nestedSettings);
  }
  /**
   * 获取模块的标题
   *
   * @param module
   * @returns
   */
  getModuleTitle(module: any): string {
    const title = module?.moduleName ?? module?.contributes?.title ?? module?.title;
    return title;
  }

  selectModule(node) {
    // console.log('selectModule', node);
    this.currentConfiguration = node.configuration || [];
    // console.log('this.currentConfiguration', this.currentConfiguration);
    this.selectListSelection.select(node);
  }

  /**
   * 解析所有模块的配置信息
   */
  private init() {
    // if (!window.eo && !window.eo?.getFeature) {
    //   return;
    // }
    // ! this.isVisible = true;
    this.nestedSettings = {};
    // 获取本地设置
    this.localSettings = window.eo?.getSettings?.() || JSON.stringify(localStorage.getItem('localSettings') || '{}');
    // const featureList = window.eo.getFeature('configuration');
    const modules = window.eo?.getModules() || new Map([]);
    // const extensitonConfigurations = [...modules.values()].filter((n) => n.contributes?.configuration);
    const extensitonConfigurations = [...modules.values()].filter((n) => n.features?.configuration);
    const controls = {};
    // 所有设置
    const allSettings = cloneDeep([eoapiSettings['eoapi-extensions']]);
    // 所有配置
    const allConfiguration = allSettings.map((n) => {
      const configuration = n.features?.configuration || n.contributes?.configuration;
      if (Array.isArray(configuration)) {
        configuration.forEach((m) => (m.moduleID ??= n.moduleID));
      } else {
        configuration.moduleID ??= n.moduleID;
      }
      return configuration;
    });
    // 第三方扩展
    const extensionsModule = allSettings.find((n) => n.moduleID === 'eoapi-extensions');
    extensitonConfigurations.forEach((item) => {
      const configuration = item?.features?.configuration || item?.contributes?.configuration;
      if (configuration) {
        const extensionsConfiguration =
          extensionsModule.features?.configuration || extensionsModule.contributes?.configuration;
        configuration.title = item.moduleName ?? configuration.title;
        configuration.moduleID = item.moduleID;
        extensionsConfiguration.push(configuration);
      }
    });
    // 给插件的属性前面追加模块ID
    const appendModuleID = (properties, moduleID) =>
      Object.keys(properties).reduce((prev, key) => {
        prev[`${moduleID}.${key}`] = properties[key];
        return prev;
      }, {});

    /** 根据configuration配置生成settings model */
    allConfiguration.forEach((item) => {
      if (Array.isArray(item)) {
        item.forEach((n) => {
          n.properties = appendModuleID(n.properties, n.moduleID);
          this.setSettingsModel(n.properties, controls);
        });
      } else {
        item.properties = appendModuleID(item.properties, item.moduleID);
        this.setSettingsModel(item.properties, controls);
      }
    });
    type Configuration = typeof allConfiguration[number] | Array<typeof allConfiguration[number]>;
    // 递归生成设置树
    const generateTreeData = (configurations: Configuration = []) =>
      [].concat(configurations).reduce<TreeNode[]>((prev, curr) => {
        if (Array.isArray(curr)) {
          return prev.concat(generateTreeData(curr));
        }
        const treeItem: TreeNode = {
          name: curr.title,
          configuration: [].concat(curr),
        };
        return prev.concat(treeItem);
      }, []);
    // 所有设置项
    const treeData = cloneDeep(this.treeNodes);
    const extensions = treeData.find((n) => n.moduleID === 'eoapi-extensions');
    const extensionConfiguration = allSettings[0].features?.configuration || allSettings[0].contributes?.configuration;
    extensions.children = generateTreeData(extensionConfiguration);
    extensions.configuration = extensionConfiguration;
    this.dataSource.setData(treeData);
    this.treeControl.expandAll();
    this.validateForm = this.fb.group(controls);
    this.validateForm.valueChanges.subscribe(debounce(this.handleSave.bind(this), 300));
    // 默认选中第一项
    this.selectModule(this.treeControl.dataNodes.at(0));
    this.handleSave();
  }

  handleShowModal() {
    this.isShowModal = true;
  }

  handleSave(): void {
    // for (const i in this.validateForm.controls) {
    //   if (this.validateForm.controls.hasOwnProperty(i)) {
    //     this.validateForm.controls[i].markAsDirty();
    //     this.validateForm.controls[i].updateValueAndValidity();
    //   }
    // }
    // if (this.validateForm.status === 'INVALID') {
    //   return;
    // }
    const data = { settings: this.settings, nestedSettings: this.nestedSettings };
    // 加入根据返回显示提示消息
    const saved = window.eo?.saveSettings
      ? window.eo.saveSettings(data)
      : localStorage.setItem('localSettings', JSON.stringify(data));
    if (saved) {
      // this.handleCancel();
    }
    console.log('localSettings', data);
  }

  async handleCancel() {
    try {
      const result = await this.pingRmoteServerUrl();
      if (Object.is(result, true)) {
        this.message.success('远程数据源连接成功');
        this.remoteService.switchToHttp();
        this.remoteService.refreshComponent();
      }
    } catch (error) {
    } finally {
      this.isShowModal = false;
      this.isShowModalChange.emit(false);
    }
  }
}
