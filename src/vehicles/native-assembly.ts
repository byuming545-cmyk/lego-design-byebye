import { NativePartRepository } from "../parts/assembly/source.js";
import { AttachmentEngine } from "../parts/assembly/engine.js";
import {
  NativeAssemblyGenerator,
  type NativeModuleRequest,
} from "../parts/assembly/generator.js";
import { inspectNativeModelImport } from "../parts/assembly/modelImport.js";
import { assessGrammarAdmission } from "../parts/grammar/admission.js";
/** Reuses the existing source admission and engine. No saved pair-fixture grants,
 * source overrides, tolerance changes or vehicle-specific placement coordinates. */
export class VehicleNativeAssembly {
  readonly repository = new NativePartRepository();
  readonly engine = new AttachmentEngine({
    mode: "production",
    getSourceSnapshot: () => this.repository.snapshotDigest,
    loadPart: (id) => this.repository.getPart(id),
    getCapability: async (id) => {
      const part = await this.repository.getPart(id);
      return part ? assessGrammarAdmission(part).capability : undefined;
    },
  });
  private generator?: NativeAssemblyGenerator;
  async generate(request: NativeModuleRequest) {
    this.generator ??= new NativeAssemblyGenerator(this.engine, {
      partIds: await this.repository.listIds(),
    });
    return this.generator.generate(request);
  }
  async importModel(value: unknown) {
    return inspectNativeModelImport(value, this.engine);
  }
}
