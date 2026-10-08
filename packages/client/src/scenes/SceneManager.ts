// 场景管理：Lobby -> Select -> Waiting -> Battle -> Result
export type SceneName = "lobby" | "select" | "waiting" | "battle" | "result";

export interface Scene {
  enter(params?: unknown): void;
  exit(): void;
  update?(dt: number): void;
}

class SceneManager {
  private scenes = new Map<SceneName, Scene>();
  private current: SceneName | null = null;

  register(name: SceneName, scene: Scene): void {
    this.scenes.set(name, scene);
  }

  switchTo(name: SceneName, params?: unknown): void {
    if (this.current) {
      this.scenes.get(this.current)?.exit();
    }
    this.current = name;
    const scene = this.scenes.get(name);
    if (scene) {
      scene.enter(params);
    }
  }

  get currentName(): SceneName | null {
    return this.current;
  }
}

export const sceneManager = new SceneManager();
