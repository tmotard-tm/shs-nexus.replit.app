/**
 * WMS Engine API Routes
 *
 * Mounts under /api/wms (registered in server/routes.ts).
 * All routes proxy to the WMS Engine API via wms-engine-service.ts.
 *
 * Trucks:
 *   POST   /api/wms/trucks                  — create truck location
 *   GET    /api/wms/trucks                  — list all trucks
 *   GET    /api/wms/trucks/:truckId         — get truck by ID
 *   POST   /api/wms/trucks/:truckId         — update truck
 *   DELETE /api/wms/trucks/:truckId         — disable/delete truck
 *
 * Assignments:
 *   POST   /api/wms/assignments             — create tech-to-truck assignment
 *   GET    /api/wms/assignments/:techId     — get assignment by tech ID
 *   PUT    /api/wms/assignments/:techId     — update assignment
 *   DELETE /api/wms/assignments/:techId     — unassign tech
 */

import { Router } from "express";
import { z } from "zod";
import { wmsEngineService } from "./wms-engine-service";

const truckRequestSchema = z.object({
  name: z.string().min(1, "name is required"),
  locationId: z.string().min(1, "locationId is required"),
  description: z.string().optional(),
  isActive: z.boolean().default(true),
  subsidiary: z.string().optional(),
  parentLocation: z.string().optional(),
  useCaseId: z.string().optional(),
});

const assignmentRequestSchema = z.object({
  techId: z.string().min(1, "techId is required"),
  truckId: z.string().min(1, "truckId is required"),
});

function handleWmsError(res: any, err: any) {
  const status = err.status || 500;
  const message = err.wmsMessage || err.message || "WMS Engine error";
  if (message.includes("not configured")) {
    return res.status(503).json({ success: false, message });
  }
  return res.status(status).json({ success: false, message });
}

export function registerWmsRoutes(requireAuth: any): Router {
  const router = Router();

  router.use(requireAuth);

  router.post("/trucks", async (req, res) => {
    try {
      const data = truckRequestSchema.parse(req.body);
      const result = await wmsEngineService.createTruck(data);
      res.status(201).json({ success: true, data: result });
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ success: false, message: err.errors[0].message });
      }
      handleWmsError(res, err);
    }
  });

  router.get("/trucks", async (req, res) => {
    try {
      const result = await wmsEngineService.getAllTrucks();
      res.json({ success: true, data: result });
    } catch (err: any) {
      handleWmsError(res, err);
    }
  });

  router.get("/trucks/:truckId", async (req, res) => {
    try {
      const { truckId } = req.params;
      const result = await wmsEngineService.getTruck(truckId);
      res.json({ success: true, data: result });
    } catch (err: any) {
      handleWmsError(res, err);
    }
  });

  router.post("/trucks/:truckId", async (req, res) => {
    try {
      const { truckId } = req.params;
      const data = truckRequestSchema.parse(req.body);
      const result = await wmsEngineService.updateTruck(truckId, data);
      res.json({ success: true, data: result });
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ success: false, message: err.errors[0].message });
      }
      handleWmsError(res, err);
    }
  });

  router.delete("/trucks/:truckId", async (req, res) => {
    try {
      const { truckId } = req.params;
      const result = await wmsEngineService.deleteTruck(truckId);
      res.json({ success: true, data: result });
    } catch (err: any) {
      handleWmsError(res, err);
    }
  });

  router.post("/assignments", async (req, res) => {
    try {
      const data = assignmentRequestSchema.parse(req.body);
      const result = await wmsEngineService.createAssignment(data);
      res.status(201).json({ success: true, data: result });
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ success: false, message: err.errors[0].message });
      }
      handleWmsError(res, err);
    }
  });

  router.get("/assignments/:techId", async (req, res) => {
    try {
      const { techId } = req.params;
      const result = await wmsEngineService.getAssignment(techId);
      res.json({ success: true, data: result });
    } catch (err: any) {
      handleWmsError(res, err);
    }
  });

  router.put("/assignments/:techId", async (req, res) => {
    try {
      const { techId } = req.params;
      const data = assignmentRequestSchema.parse(req.body);
      const result = await wmsEngineService.updateAssignment(techId, data);
      res.json({ success: true, data: result });
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ success: false, message: err.errors[0].message });
      }
      handleWmsError(res, err);
    }
  });

  router.delete("/assignments/:techId", async (req, res) => {
    try {
      const { techId } = req.params;
      const result = await wmsEngineService.deleteAssignment(techId);
      res.json({ success: true, data: result });
    } catch (err: any) {
      handleWmsError(res, err);
    }
  });

  // Debug: force a fresh token fetch and return diagnostic info
  router.get("/debug/auth", async (req, res) => {
    try {
      const result = await wmsEngineService.debugAuth();
      res.json({ success: true, data: result });
    } catch (err: any) {
      handleWmsError(res, err);
    }
  });

  return router;
}
