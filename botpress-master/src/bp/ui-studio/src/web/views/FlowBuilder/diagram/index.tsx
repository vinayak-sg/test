import {
  Button,
  ContextMenu,
  ControlGroup,
  InputGroup,
  Intent,
  Menu,
  MenuDivider,
  MenuItem,
  Position,
  Tag,
  Toaster
} from '@blueprintjs/core'
import { IO } from 'botpress/sdk'
import { lang, MainLayout, sharedStyle } from 'botpress/shared'
import cx from 'classnames'
import _ from 'lodash'
import React, { Component, Fragment } from 'react'
import ReactDOM from 'react-dom'
import { connect } from 'react-redux'
import { DefaultPortModel, DiagramEngine, DiagramWidget, NodeModel, PointModel } from 'storm-react-diagrams'
import {
  buildNewSkill,
  closeFlowNodeProps,
  copyFlowNode,
  createFlow,
  createFlowNode,
  fetchFlows,
  insertNewSkillNode,
  openFlowNodeProps,
  pasteFlowNode,
  removeFlowNode,
  setDiagramAction,
  switchFlow,
  switchFlowNode,
  updateFlow,
  updateFlowNode,
  updateFlowProblems,
  zoomToLevel
} from '~/actions'
import { SearchBar } from '~/components/Shared/Interface'
import { getCurrentFlow, getCurrentFlowNode } from '~/reducers'
import { SaySomethingWidgetFactory } from '~/views/OneFlow/diagram/nodes/SaySomethingNode'

import WorkflowToolbar from '../../OneFlow/diagram/WorkflowToolbar'

import { prepareEventForDiagram } from './debugger'
import { defaultTransition, DiagramManager, DIAGRAM_PADDING, nodeTypes, Point } from './manager'
import { DeletableLinkFactory } from './nodes/LinkWidget'
import { SkillCallNodeModel, SkillCallWidgetFactory } from './nodes/SkillCallNode'
import { StandardNodeModel, StandardWidgetFactory } from './nodes/StandardNode'
import { ActionWidgetFactory } from './nodes_v2/ActionNode'
import { ExecuteWidgetFactory } from './nodes_v2/ExecuteNode'
import { ListenWidgetFactory } from './nodes_v2/ListenNode'
import { RouterNodeModel, RouterWidgetFactory } from './nodes_v2/RouterNode'
import style from './style.scss'
import NodeToolbar from './NodeToolbar'
import ZoomToolbar from './ZoomToolbar'

interface OwnProps {
  childRef: (el: any) => void
  readOnly: boolean
  canPasteNode: boolean
  selectedTopic: string
  selectedWorkflow: string
  flowPreview: boolean
  highlightFilter: string
  showSearch: boolean
  hideSearch: () => void
  currentLang: string
  setCurrentLang: (lang: string) => void
  languages: string[]
  defaultLang: string
  handleFilterChanged: (event: any) => void
}

type StateProps = ReturnType<typeof mapStateToProps>
type DispatchProps = typeof mapDispatchToProps

type Props = DispatchProps & StateProps & OwnProps

type BpNodeModel = StandardNodeModel | SkillCallNodeModel

type ExtendedDiagramEngine = {
  enableLinkPoints?: boolean
  flowBuilder?: any
} & DiagramEngine

class Diagram extends Component<Props> {
  private diagramEngine: ExtendedDiagramEngine
  private diagramWidget: DiagramWidget
  private diagramContainer: HTMLDivElement
  private searchRef: React.RefObject<HTMLInputElement>
  private manager: DiagramManager
  /** Represents the source port clicked when the user is connecting a node */
  private dragPortSource: any

  state = {
    nodeInfos: []
  }

  constructor(props) {
    super(props)

    this.diagramEngine = new DiagramEngine()
    this.diagramEngine.registerNodeFactory(new StandardWidgetFactory())
    this.diagramEngine.registerNodeFactory(new SkillCallWidgetFactory(this.props.skills))
    this.diagramEngine.registerNodeFactory(new SaySomethingWidgetFactory())
    this.diagramEngine.registerNodeFactory(new ExecuteWidgetFactory())
    this.diagramEngine.registerNodeFactory(new ListenWidgetFactory())
    this.diagramEngine.registerNodeFactory(new RouterWidgetFactory())
    this.diagramEngine.registerNodeFactory(new ActionWidgetFactory())
    this.diagramEngine.registerLinkFactory(new DeletableLinkFactory())

    // This reference allows us to update flow nodes from widgets
    this.diagramEngine.flowBuilder = this
    this.manager = new DiagramManager(this.diagramEngine, {
      switchFlowNode: this.props.switchFlowNode,
      zoomToLevel: this.props.zoomToLevel
    })

    if (this.props.highlightFilter) {
      this.manager.setHighlightFilter(this.props.highlightFilter)
    }

    // @ts-ignore
    window.showEventOnDiagram = () => {
      return event => this.showEventOnDiagram(event)
    }
  }

  getDebugInfo = (nodeName: string) => {
    return (this.state.nodeInfos ?? [])
      .filter(x => x.workflow === this.props.currentFlow?.name.replace('.flow.json', ''))
      .find(x => x?.node === nodeName)
  }

  showEventOnDiagram(event?: IO.IncomingEvent) {
    if (!event) {
      this.manager.setHighlightedNodes([])
      this.setState({ nodeInfos: [] })
      return
    }

    const { flows } = this.props
    const { nodeInfos, highlightedNodes } = prepareEventForDiagram(event, flows)

    this.manager.setHighlightedNodes(highlightedNodes)
    this.manager.highlightLinkedNodes()
    this.setState({ nodeInfos })

    if (highlightedNodes.length) {
      const firstFlow = highlightedNodes[0].flow

      if (this.props.currentFlow?.name !== firstFlow) {
        this.props.switchFlow(firstFlow)
      }
    }

    this.searchRef = React.createRef()
  }

  componentDidMount() {
    this.props.fetchFlows()
    ReactDOM.findDOMNode(this.diagramWidget).addEventListener('click', this.onDiagramClick)
    document.getElementById('diagramContainer').addEventListener('keydown', this.onKeyDown)
  }

  componentWillUnmount() {
    ReactDOM.findDOMNode(this.diagramWidget).removeEventListener('click', this.onDiagramClick)
    document.getElementById('diagramContainer').removeEventListener('keydown', this.onKeyDown)
  }

  componentDidUpdate(prevProps, prevState) {
    this.manager.setCurrentFlow(this.props.currentFlow)
    this.manager.setReadOnly(this.props.readOnly)

    if (this.diagramContainer) {
      this.manager.setDiagramContainer(this.diagramWidget, {
        width: this.diagramContainer.offsetWidth,
        height: this.diagramContainer.offsetHeight
      })
    }

    if (this.dragPortSource && !prevProps.currentFlowNode && this.props.currentFlowNode) {
      // tslint:disable-next-line: no-floating-promises
      this.linkCreatedNode()
    }

    if (prevProps.zoomLevel !== this.props.zoomLevel) {
      this.diagramEngine.diagramModel.setZoomLevel(this.props.zoomLevel)
    }

    const isDifferentFlow = _.get(prevProps, 'currentFlow.name') !== _.get(this, 'props.currentFlow.name')

    if (!this.props.currentFlow) {
      this.manager.clearModel()
    } else if (!prevProps.currentFlow || isDifferentFlow) {
      // Update the diagram model only if we changed the current flow
      this.manager.initializeModel()
      this.checkForProblems()
    } else {
      // Update the current model with the new properties
      this.manager.syncModel()
    }

    // Refresh nodes when the filter is displayed
    if (this.props.highlightFilter) {
      this.manager.setHighlightFilter(this.props.highlightFilter)
      this.manager.syncModel()
    }

    // Refresh nodes when the filter is updated
    if (this.props.highlightFilter !== prevProps.highlightFilter) {
      this.manager.setHighlightFilter(this.props.highlightFilter)
      this.manager.syncModel()
    }
  }

  updateTransitionNode = async (nodeId: string, index: number, newName: string) => {
    await this.props.switchFlowNode(nodeId)
    const next = this.props.currentFlowNode.next

    if (!next.length) {
      this.props.updateFlowNode({ next: [{ condition: 'true', node: newName }] })
    } else {
      await this.props.updateFlowNode({
        next: Object.assign([], next, { [index]: { ...next[index], node: newName } })
      })
    }

    this.checkForLinksUpdate()
    this.diagramWidget.forceUpdate()
  }

  linkCreatedNode = async () => {
    const sourcePort: DefaultPortModel = _.get(this.dragPortSource, 'parent.sourcePort')
    this.dragPortSource = undefined

    if (!sourcePort || sourcePort.parent.id === this.props.currentFlowNode.id) {
      return
    }

    if (!sourcePort.in) {
      const sourcePortIndex = Number(sourcePort.name.replace('out', ''))
      await this.updateTransitionNode(sourcePort.parent.id, sourcePortIndex, this.props.currentFlowNode.name)
    } else {
      await this.updateTransitionNode(this.props.currentFlowNode.id, 0, sourcePort.parent['name'])
    }
  }

  add = {
    flowNode: (point: Point) => this.props.createFlowNode({ ...point, type: 'standard' }),
    skillNode: (point: Point, skillId: string) => this.props.buildSkill({ location: point, id: skillId }),
    sayNode: (point: Point) =>
      this.props.createFlowNode({ ...point, type: 'say_something', next: [defaultTransition] }),
    executeNode: (point: Point) => this.props.createFlowNode({ ...point, type: 'execute', next: [defaultTransition] }),
    listenNode: (point: Point) =>
      this.props.createFlowNode({ ...point, type: 'listen', onReceive: [], next: [defaultTransition] }),
    routerNode: (point: Point) => this.props.createFlowNode({ ...point, type: 'router' }),
    actionNode: (point: Point) => this.props.createFlowNode({ ...point, type: 'action', next: [defaultTransition] })
  }

  handleContextMenuNoElement = (event: React.MouseEvent) => {
    const point = this.manager.getRealPosition(event)

    // When no element is chosen from the context menu, we reset the start port so it doesn't impact the next selected node
    let clearStartPortOnClose = true

    const wrap = (addNodeMethod, ...args) => () => {
      clearStartPortOnClose = false
      addNodeMethod(...args)
    }

    ContextMenu.show(
      <Menu>
        {this.props.canPasteNode && (
          <MenuItem icon="clipboard" text={lang.tr('paste')} onClick={() => this.pasteElementFromBuffer(point)} />
        )}
        <MenuDivider title={lang.tr('studio.flow.addNode')} />
        <MenuItem
          text={lang.tr('studio.flow.nodeType.standard')}
          onClick={wrap(this.add.flowNode, point)}
          icon="chat"
        />
        {window.EXPERIMENTAL ? (
          <Fragment>
            <MenuItem text={lang.tr('say')} onClick={wrap(this.add.sayNode, point)} icon="comment" />
            <MenuItem text={lang.tr('execute')} onClick={wrap(this.add.executeNode, point)} icon="code-block" />
            <MenuItem text={lang.tr('listen')} onClick={wrap(this.add.listenNode, point)} icon="hand" />
            <MenuItem text={lang.tr('router')} onClick={wrap(this.add.routerNode, point)} icon="search-around" />
            <MenuItem text={lang.tr('action')} onClick={wrap(this.add.actionNode, point)} icon="offline" />
          </Fragment>
        ) : null}
        <MenuItem tagName="button" text={lang.tr('skills')} icon="add">
          {this.props.skills.map(skill => (
            <MenuItem
              key={skill.id}
              text={lang.tr(skill.name)}
              tagName="button"
              onClick={wrap(this.add.skillNode, point, skill.id)}
              icon={skill.icon}
            />
          ))}
        </MenuItem>
      </Menu>,
      { left: event.clientX, top: event.clientY },
      () => {
        if (clearStartPortOnClose) {
          this.dragPortSource = undefined
        }
      }
    )
  }

  handleContextMenu = (event: React.MouseEvent) => {
    event.preventDefault()

    const target = this.diagramWidget.getMouseElement(event)
    if (!target && !this.props.readOnly) {
      this.handleContextMenuNoElement(event)
      return
    }

    const targetModel = target && target.model
    const targetName = _.get(target, 'model.name')
    const point = this.manager.getRealPosition(event)

    const canMakeStartNode = () => {
      const current = this.props.currentFlow && this.props.currentFlow.startNode
      return current && targetName && current !== targetName
    }

    const setAsCurrentNode = () => this.props.updateFlow({ startNode: targetName })
    const isStartNode = targetName === this.props.currentFlow.startNode
    const isNodeTargeted = targetModel instanceof NodeModel

    // Prevents displaying an empty menu
    if ((!isNodeTargeted && !this.props.canPasteNode) || this.props.readOnly) {
      return
    }

    const canAddChipToTarget = this._canAddTransitionChipToTarget(target)

    const addTransitionNode = async () => {
      await this._addTransitionChipToRouter(target)
    }

    ContextMenu.show(
      <Menu>
        {!isNodeTargeted && this.props.canPasteNode && (
          <MenuItem icon="clipboard" text={lang.tr('paste')} onClick={() => this.pasteElementFromBuffer(point)} />
        )}
        {isNodeTargeted && (
          <Fragment>
            <MenuItem
              icon="trash"
              text={lang.tr('delete')}
              disabled={isStartNode}
              onClick={() => this.deleteSelectedElements()}
            />
            <MenuItem
              icon="duplicate"
              text={lang.tr('copy')}
              onClick={() => {
                this.props.switchFlowNode(targetModel.id)
                this.copySelectedElementToBuffer()
              }}
            />
            <MenuDivider />
            <MenuItem
              icon="star"
              text={lang.tr('studio.flow.setAsStart')}
              disabled={!canMakeStartNode()}
              onClick={() => setAsCurrentNode()}
            />
            <MenuItem
              icon="minimize"
              text={lang.tr('studio.flow.disconnectNode')}
              onClick={() => {
                this.manager.disconnectPorts(targetModel)
                this.checkForLinksUpdate()
              }}
            />
            {window.EXPERIMENTAL && canAddChipToTarget ? (
              <React.Fragment>
                <MenuDivider />
                <MenuItem text={lang.tr('studio.flow.chips')}>
                  <MenuItem text={lang.tr('studio.flow.transition')} onClick={addTransitionNode} icon="flow-end" />
                </MenuItem>
              </React.Fragment>
            ) : null}
          </Fragment>
        )}
      </Menu>,
      { left: event.clientX, top: event.clientY }
    )
  }

  checkForProblems = _.debounce(() => {
    this.props.updateFlowProblems(this.manager.getNodeProblems())
  }, 500)

  createFlow(name: string) {
    this.props.createFlow(`${name}.flow.json`)
  }

  canTargetOpenInspector = target => {
    if (!target) {
      return false
    }

    const targetModel = target.model
    return (
      targetModel instanceof StandardNodeModel ||
      targetModel instanceof SkillCallNodeModel ||
      targetModel instanceof RouterNodeModel
    )
  }

  onDiagramClick = (event: MouseEvent) => {
    const selectedNode = this.manager.getSelectedNode() as BpNodeModel
    const currentNode = this.props.currentFlowNode
    const target = this.diagramWidget.getMouseElement(event)

    this.manager.sanitizeLinks()
    this.manager.cleanPortLinks()

    if (selectedNode && selectedNode instanceof PointModel) {
      this.dragPortSource = selectedNode
      this.handleContextMenu(event as any)
    }

    this.canTargetOpenInspector(target) ? this.props.openFlowNodeProps() : this.props.closeFlowNodeProps()

    if (!selectedNode) {
      this.props.closeFlowNodeProps()
      this.props.switchFlowNode(null)
    } else if (selectedNode && (!currentNode || selectedNode.id !== currentNode.id)) {
      // Different node selected
      this.props.switchFlowNode(selectedNode.id)
    }

    if (selectedNode && (selectedNode.oldX !== selectedNode.x || selectedNode.oldY !== selectedNode.y)) {
      this.props.updateFlowNode({ x: selectedNode.x, y: selectedNode.y })
      Object.assign(selectedNode, { oldX: selectedNode.x, oldY: selectedNode.y })
    }

    this.checkForLinksUpdate()
  }

  checkForLinksUpdate = _.debounce(
    () => {
      if (this.props.readOnly) {
        return
      }

      const links = this.manager.getLinksRequiringUpdate()
      if (links) {
        this.props.updateFlow({ links })
      }

      this.checkForProblems()
    },
    500,
    { leading: true }
  )

  deleteSelectedElements() {
    const elements = _.sortBy(this.diagramEngine.getDiagramModel().getSelectedItems(), 'nodeType')

    // Use sorting to make the nodes first in the array, deleting the node before the links
    for (const element of elements) {
      if (!this.diagramEngine.isModelLocked(element)) {
        if (element['isStartNode']) {
          return alert(lang.tr('studio.flow.cantDeleteStart'))
        } else if (
          // @ts-ignore
          _.includes(nodeTypes, element.nodeType) ||
          _.includes(nodeTypes, element.type)
        ) {
          this.props.removeFlowNode(element)
        } else if (element.type === 'default') {
          element.remove()
          this.checkForLinksUpdate()
        } else {
          element.remove() // it's a point or something else
        }
      }
    }

    this.props.closeFlowNodeProps()
    this.diagramWidget.forceUpdate()
    this.checkForProblems()
  }

  copySelectedElementToBuffer() {
    this.props.copyFlowNode()
    Toaster.create({
      className: 'recipe-toaster',
      position: Position.TOP_RIGHT
    }).show({ message: lang.tr('studio.flow.copiedToBuffer') })
  }

  pasteElementFromBuffer(position?) {
    if (position) {
      this.props.pasteFlowNode(position)
    } else {
      const { offsetX, offsetY } = this.manager.getActiveModelOffset()
      this.props.pasteFlowNode({ x: -offsetX + DIAGRAM_PADDING, y: -offsetY + DIAGRAM_PADDING })
    }

    this.manager.unselectAllElements()
  }

  onKeyDown = event => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'c') {
      this.copySelectedElementToBuffer()
    } else if ((event.ctrlKey || event.metaKey) && event.key === 'v') {
      this.pasteElementFromBuffer()
    }
  }

  handleFlowWideClicked = () => {
    this.props.switchFlowNode(null)
    this.props.openFlowNodeProps()
  }

  renderCatchAllInfo() {
    const nbNext = _.get(this.props.currentFlow, 'catchAll.next.length', 0)
    const nbReceive = _.get(this.props.currentFlow, 'catchAll.onReceive.length', 0)

    return (
      <div style={{ display: 'flex', marginTop: 5 }}>
        <Button onClick={this.handleFlowWideClicked} minimal>
          <Tag intent={nbNext > 0 ? Intent.PRIMARY : Intent.NONE}>{nbNext}</Tag>
          {lang.tr('studio.flow.flowWideTransitions', { count: nbNext })}
        </Button>
        <Button onClick={this.handleFlowWideClicked} minimal>
          <Tag intent={nbReceive > 0 ? Intent.PRIMARY : Intent.NONE}>{nbReceive}</Tag>{' '}
          {lang.tr('studio.flow.flowWideOnReceives', { count: nbReceive })}
        </Button>
      </div>
    )
  }

  handleToolDropped = async (event: React.DragEvent) => {
    if (this.props.readOnly) {
      return
    }

    this.manager.unselectAllElements()
    const data = JSON.parse(event.dataTransfer.getData('diagram-node'))

    const point = this.manager.getRealPosition(event)

    if (data.type === 'chip') {
      const target = this.diagramWidget.getMouseElement(event)
      if (this._canAddTransitionChipToTarget(target)) {
        await this._addTransitionChipToRouter(target)
      }
    } else if (data.type === 'skill') {
      this.add.skillNode(point, data.id)
    } else if (data.type === 'node') {
      switch (data.id) {
        case 'say_something':
          this.add.sayNode(point)
          break
        case 'execute':
          this.add.executeNode(point)
          break
        case 'listen':
          this.add.listenNode(point)
          break
        case 'router':
          this.add.routerNode(point)
          break
        case 'action':
          this.add.actionNode(point)
          break
        default:
          this.add.flowNode(point)
          break
      }
    }
  }

  private async _addTransitionChipToRouter(target) {
    await this.props.switchFlowNode(target.model.id)
    this.props.updateFlowNode({ next: [...this.props.currentFlowNode.next, defaultTransition] })
  }

  private _canAddTransitionChipToTarget(target): boolean {
    if (this.props.readOnly) {
      return false
    }

    return target && target.model instanceof RouterNodeModel
  }

  render() {
    const canAdd = !this.props.defaultLang || this.props.defaultLang === this.props.currentLang

    return (
      <MainLayout.Wrapper
        className={cx({
          'emulator-open': this.props.emulatorOpen
        })}
      >
        <WorkflowToolbar />

        <div className={style.searchWrapper}>
          <SearchBar
            id="input-highlight-name"
            className={style.noPadding}
            ref={this.searchRef}
            onBlur={this.props.hideSearch}
            value={this.props.highlightFilter}
            placeholder={lang.tr('studio.flow.filterNodes')}
            onChange={value => this.props.handleFilterChanged({ target: { value } })}
          />
        </div>
        <div
          id="diagramContainer"
          ref={ref => (this.diagramContainer = ref)}
          tabIndex={1}
          style={{ outline: 'none', width: '100%', height: '100%' }}
          onContextMenu={this.handleContextMenu}
          onDrop={this.handleToolDropped}
          onDragOver={event => event.preventDefault()}
        >
          <div className={style.floatingInfo}>{this.renderCatchAllInfo()}</div>

          <DiagramWidget
            ref={w => (this.diagramWidget = w)}
            deleteKeys={[]}
            diagramEngine={this.diagramEngine}
            inverseZoom
          />
          <ZoomToolbar />
          {canAdd && <NodeToolbar />}
        </div>
      </MainLayout.Wrapper>
    )
  }
}

const mapStateToProps = state => ({
  flows: state.flows,
  currentFlow: getCurrentFlow(state),
  currentFlowNode: getCurrentFlowNode(state),
  currentDiagramAction: state.flows.currentDiagramAction,
  canPasteNode: Boolean(state.flows.nodeInBuffer),
  emulatorOpen: state.ui.emulatorOpen,
  zoomLevel: state.ui.zoomLevel,
  skills: state.skills.installed
})

const mapDispatchToProps = {
  fetchFlows,
  switchFlowNode,
  openFlowNodeProps,
  closeFlowNodeProps,
  setDiagramAction,
  createFlowNode,
  removeFlowNode,
  createFlow,
  updateFlowNode,
  switchFlow,
  updateFlow,
  copyFlowNode,
  pasteFlowNode,
  insertNewSkillNode,
  updateFlowProblems,
  zoomToLevel,
  buildSkill: buildNewSkill
}

export default connect(mapStateToProps, mapDispatchToProps, null, { withRef: true })(Diagram)
